import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { GmailMessage, GmailMessageSummary, GoogleApi } from '../../connectors/google/api';
import type { InjectionScreen, DocumentsApi, DraftsLog } from '../../runtime/types';
import type { ToolContext, ToolDefinition } from '../../../shared/tools';
import { PixelRegistry, registryLabel } from './registry';
import { withTempFile } from './tempFile';
import { extractPdfText } from '../../connectors/fs/pdfText';

const MAX_DRAFT_BYTES = 25 * 1024 * 1024;
const MAX_ASK_BYTES = 20 * 1024 * 1024;
const BLOCKED = new Set(['.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jse', '.wsf', '.lnk', '.scr', '.com', '.reg', '.hta', '.jar']);
const ASK_TYPES = new Set(['.pdf', '.txt', '.md', '.csv', '.docx', '.pptx', '.xlsx', '.json']);
const ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;
const error = (code: string) => ({ error: code });

export type SafePathResult = { ok: true; abs: string; root: string } | { ok: false; reason: string };
export interface GmailToolDeps {
  google: GoogleApi;
  screen: InjectionScreen;
  registry: PixelRegistry;
  documents: DocumentsApi;
  /** Archie supplies this; absent means local attachments fail closed. */
  safePath?: (input: string) => Promise<SafePathResult> | SafePathResult;
  ensureConnected?: () => Promise<boolean> | boolean;
  draftsLog?: DraftsLog;
  dataDir?: string;
}

type CreateInput = { recipients: string[]; cc_recipients?: string[]; subject: string; body: string; attachments?: string[] };
type ReplyInput = { thread_id: string; body: string; reply_all?: boolean; attachments?: string[] };
type UpdateInput = { draft_id: string; subject?: string; body?: string };

function header(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('INVALID_HEADER');
  return value;
}
function address(value: string): string {
  const cleaned = header(value).trim();
  if (!ADDRESS.test(cleaned) || cleaned.length > 254) throw new Error('INVALID_RECIPIENT');
  return cleaned;
}
function addresses(values: string[], allowEmpty = false): string[] {
  if (!Array.isArray(values) || values.length > 10 || (!allowEmpty && !values.length)) throw new Error('INVALID_RECIPIENT');
  return values.map(address);
}
function parseAddresses(value?: string): string[] {
  if (!value) return [];
  return value.split(',').map(part => part.trim()).map(part => /<([^<>]+)>/.exec(part)?.[1] ?? part).map(address);
}
function getHeader(message: GmailMessage, name: string): string | undefined {
  const key = Object.keys(message.headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? message.headers[key] : undefined;
}
function htmlToText(html: string): string {
  return html.replace(/<(?:(?:script|style|template|head)\b)[^>]*>[\s\S]*?<\/\s*(?:script|style|template|head)\s*>/gi, '')
    .replace(/<[^>]*(?:\bhidden\b|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|color\s*:\s*(?:white|#fff(?:fff)?))[^"']*["'])[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/gi, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ', '&#39;': "'" })[entity.toLowerCase()] ?? entity);
}
function stripQuotes(text: string): string {
  return text.split('\n').filter(line => !/^\s*>/.test(line)).join('\n').split(/\nOn .{5,200}wrote:\s*\n/i)[0].trim();
}
function source(ctx: ToolContext) { return { kind: 'email' as const, name: 'Gmail', taskId: ctx.taskId, jobId: ctx.jobId }; }
function sanitizeUntrusted(text: string): string { return text.replace(/<\s*\/\s*untrusted/gi, '&lt;/untrusted'); }
async function outside(deps: GmailToolDeps, text: string, ctx: ToolContext, rawHtml?: string): Promise<string> {
  const raw = rawHtml ? await deps.screen.screen(rawHtml, source(ctx)) : undefined;
  const result = await deps.screen.screen(sanitizeUntrusted(text), source(ctx));
  if (raw?.flagged && !result.flagged) ctx.emit({ type: 'wolf.alert', agentId: 'wolf', taskId: ctx.taskId, source: 'email', reason: 'Hidden HTML instruction detected' });
  const flagged = Boolean(raw?.flagged || result.flagged);
  const inner = result.wrapped.replace(/^<untrusted\b[^>]*>/i, '').replace(/<\/untrusted>\s*$/i, '');
  return `<untrusted source="email" flagged="${flagged}">${inner}</untrusted>`;
}
function base64(data: string | Uint8Array): string { return Buffer.from(data).toString('base64'); }
function line(name: string, value: string): string { return `${name}: ${header(value)}`; }
function mime(input: { recipients: string[]; cc?: string[]; subject: string; body: string; replyId?: string; references?: string; attachments?: { name: string; bytes: Uint8Array }[] }): string {
  const lines = [line('To', input.recipients.join(', ')), ...(input.cc?.length ? [line('Cc', input.cc.join(', '))] : []), line('Subject', input.subject), 'MIME-Version: 1.0'];
  if (input.replyId) lines.push(line('In-Reply-To', input.replyId));
  if (input.references) lines.push(line('References', input.references));
  if (!input.attachments?.length) return base64(`${lines.join('\r\n')}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(input.body)}\r\n`);
  const boundary = `ade-${randomBytes(16).toString('hex')}`;
  lines.push(line('Content-Type', `multipart/mixed; boundary="${boundary}"`));
  const parts = [`${lines.join('\r\n')}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(input.body)}\r\n`];
  for (const item of input.attachments) parts.push(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${header(item.name.replace(/["\\]/g, '_'))}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(item.bytes)}\r\n`);
  parts.push(`--${boundary}--\r\n`);
  return base64(parts.join(''));
}

async function localAttachments(deps: GmailToolDeps, paths: string[] = []): Promise<{ name: string; bytes: Uint8Array }[]> {
  if (paths.length > 5) throw new Error('TOO_MANY_ATTACHMENTS');
  if (paths.length && !deps.safePath) throw new Error('ATTACHMENT_PATH_UNAVAILABLE');
  const output: { name: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const input of paths) {
    const safe = await deps.safePath!(input);
    if (!safe.ok) throw new Error('ATTACHMENT_PATH_DENIED');
    const name = safe.abs.split(/[\\/]/).at(-1) ?? '';
    if (BLOCKED.has(extname(name).toLowerCase())) throw new Error('ATTACHMENT_TYPE_DENIED');
    const info = await stat(safe.abs);
    if (!info.isFile()) throw new Error('ATTACHMENT_NOT_FILE');
    total += info.size;
    if (total > MAX_DRAFT_BYTES) throw new Error('ATTACHMENT_TOO_LARGE');
    output.push({ name, bytes: await readFile(safe.abs) });
  }
  return output;
}

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
const string = { type: 'string' };
const attachmentParam = { type: 'array', items: string, maxItems: 5 };
const openUrl = 'https://mail.google.com/mail/u/0/#drafts';

export function createGmailTools(deps: GmailToolDeps): ToolDefinition[] {
  const connected = async () => deps.ensureConnected ? Boolean(await deps.ensureConnected()) : Boolean(await deps.google.whoAmI());
  const guard = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try { return await fn(); }
    catch (cause) { return error(cause instanceof Error ? cause.message : 'UNAVAILABLE'); }
  };
  const listing = async (message: GmailMessageSummary, ctx: ToolContext) => ({
    id: message.id, threadId: message.threadId, date: message.internalDate,
    unread: message.labels.includes('UNREAD'),
    from: await outside(deps, message.from, ctx), subject: await outside(deps, message.subject, ctx),
    snippet: await outside(deps, message.snippet, ctx),
  });
  const saveDraft = async (draft: { id: string; messageId: string; threadId?: string }, subject: string, toCount: number, ctx: ToolContext) => {
    const eventSubject = registryLabel(subject);
    await deps.registry.record({ kind: 'draft', id: draft.id, messageId: draft.messageId, threadId: draft.threadId, subject, toCount, createdAt: Date.now(), state: 'waiting' });
    await deps.draftsLog?.record({ gmailDraftId: draft.id, ts: Date.now(), toCount, subject: eventSubject });
    ctx.emit({ type: 'artifact', agentId: 'workspace', taskId: ctx.taskId, kind: 'email_draft', title: 'Gmail draft', data: { draftId: draft.id, toCount, subject: eventSubject }, openUrl });
    return { draft_id: draft.id, openUrl };
  };

  return [
    { name: 'gmail_search', description: "Search Gmail; returns wrapped, untrusted listing.", parameters: schema({ query: { ...string, maxLength: 300 }, max_results: { type: 'integer', minimum: 1, maximum: 25 } }), risk: 'read', execute: (input: { query?: string; max_results?: number }, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      return { messages: await Promise.all((await deps.google.gmail.search(input.query ?? 'in:inbox newer_than:1d', Math.min(25, input.max_results ?? 25))).map(m => listing(m, ctx))) };
    }) },
    { name: 'gmail_read_thread', description: 'Read a thread as wrapped plain text with attachments listed.', parameters: schema({ thread_id: string, max_messages: { type: 'integer', minimum: 1, maximum: 6 } }, ['thread_id']), risk: 'read', execute: (input: { thread_id: string; max_messages?: number }, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      const thread = await deps.google.gmail.getThread(input.thread_id);
      const messages = await Promise.all(thread.messages.slice(-Math.min(6, input.max_messages ?? 4)).map(async m => ({
        id: m.id, date: m.internalDate, from: await outside(deps, m.from, ctx), subject: await outside(deps, m.subject, ctx),
        content: await outside(deps, stripQuotes(m.htmlBody ? htmlToText(m.htmlBody) : m.textBody).slice(0, 4000), ctx, m.htmlBody),
        attachments: await Promise.all(m.attachments.map(async a => ({ id: a.id, size: a.size, filename: await outside(deps, a.filename, ctx) }))),
      })));
      return { thread_id: thread.id, messages };
    }) },
    { name: 'gmail_digest', description: 'Recent inbox counts and people-first listing.', parameters: schema({ since_hours: { type: 'integer', minimum: 1, maximum: 168 } }), risk: 'read', execute: (input: { since_hours?: number }, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      const all = await deps.google.gmail.search(`in:inbox newer_than:${Math.min(168, input.since_hours ?? 24)}h`, 100);
      const details = await Promise.all(all.map(async summary => ({ summary, full: await deps.google.gmail.getMessage(summary.id) })));
      const bulk = details.filter(({ summary, full }) => summary.labels.some(l => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(l)) || Boolean(getHeader(full, 'List-Unsubscribe')));
      const candidates = details.filter(item => !bulk.includes(item));
      const ranked = candidates.sort((a, b) => {
        const score = ({ summary, full }: typeof a) => Number(summary.labels.includes('IMPORTANT')) * 8 + Number(summary.labels.includes('STARRED')) * 8 + Number(Boolean(getHeader(full, 'References') || getHeader(full, 'In-Reply-To'))) * 4 + Number(summary.labels.includes('UNREAD')) * 2;
        return score(b) - score(a) || b.summary.internalDate - a.summary.internalDate;
      }).slice(0, 10).map(item => item.summary);
      const top = await Promise.all(ranked.map(m => listing(m, ctx)));
      const artifactTop = ranked.slice(0, 5).map(m => ({ id: m.id, from: registryLabel(m.from).slice(0, 80), subject: registryLabel(m.subject).slice(0, 80) }));
      ctx.emit({ type: 'artifact', agentId: 'workspace', taskId: ctx.taskId, kind: 'email_digest', title: 'Inbox digest', data: { total: all.length, unread: all.filter(m => m.labels.includes('UNREAD')).length, bulk: bulk.length, top: artifactTop } });
      return { total: all.length, unread: all.filter(m => m.labels.includes('UNREAD')).length, bulk: bulk.length, top };
    }) },
    { name: 'gmail_list_drafts', description: 'List waiting Gmail drafts made by Pixel.', parameters: schema({}), risk: 'read', execute: (_: object, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      const remote = new Set((await deps.google.gmail.listDrafts(100)).map(d => d.id));
      const rows = (await deps.registry.all()).filter(r => r.kind === 'draft' && r.state === 'waiting' && remote.has(r.id));
      return { drafts: await Promise.all(rows.map(async r => ({ draft_id: r.id, thread_id: r.threadId, subject: await outside(deps, r.subject ?? '', ctx), to_count: r.toCount }))) };
    }) },
    { name: 'gmail_ask_attachment', description: 'Attach an email attachment to this job thread for questions.', parameters: schema({ message_id: string, attachment_id: string }, ['message_id', 'attachment_id']), risk: 'read', execute: (input: { message_id: string; attachment_id: string }, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      const message = await deps.google.gmail.getMessage(input.message_id);
      const item = message.attachments.find(a => a.id === input.attachment_id);
      if (!item) return error('ATTACHMENT_NOT_FOUND');
      const extension = extname(item.filename).toLowerCase();
      if (!ASK_TYPES.has(extension) || BLOCKED.has(extension)) return error('ATTACHMENT_TYPE_DENIED');
      if (item.size > MAX_ASK_BYTES) return error('ATTACHMENT_TOO_LARGE');
      const bytes = await deps.google.gmail.getAttachment(input.message_id, input.attachment_id);
      if (bytes.byteLength > MAX_ASK_BYTES) return error('ATTACHMENT_TOO_LARGE');
      if (['.txt', '.md', '.csv', '.json'].includes(extension)) await deps.screen.screen(sanitizeUntrusted(Buffer.from(bytes).toString('utf8').slice(0, 20_000)), { kind: 'doc', name: 'Gmail attachment', taskId: ctx.taskId, jobId: ctx.jobId });
      // PDFs are read on this machine (pdf.js): the text comes back screened, nothing is uploaded.
      if (extension === '.pdf') return withTempFile(bytes, item.filename, async path => {
        ctx.signal.throwIfAborted();
        const pdf = await extractPdfText(path, 24_000);
        if ('error' in pdf) return error(pdf.error);
        const screened = await deps.screen.screen(pdf.text, { kind: 'doc', name: 'Gmail attachment', taskId: ctx.taskId, jobId: ctx.jobId });
        return { ok: true, name: item.filename, pages: pdf.pages, pages_read: pdf.pagesRead, truncated: pdf.truncated, text: screened.wrapped, flagged: screened.flagged };
      }, deps.dataDir, ctx.signal);
      return withTempFile(bytes, item.filename, async path => {
        ctx.signal.throwIfAborted();
        const uploaded = await deps.documents.uploadToThread(ctx.threadId, path);
        const indexed = await deps.documents.waitIndexed(uploaded.documentId, 60_000);
        if (indexed.status !== 'indexed') return error('INDEX_FAILED');
        return { ok: true, document_id: uploaded.documentId, chunks: indexed.chunks };
      }, deps.dataDir, ctx.signal);
    }) },
    { name: 'gmail_create_draft', description: 'Create a new plain-text Gmail draft.', parameters: schema({ recipients: { type: 'array', items: string, minItems: 1, maxItems: 10 }, cc_recipients: { type: 'array', items: string, maxItems: 10 }, subject: { ...string, maxLength: 200 }, body: { ...string, maxLength: 20_000 }, attachments: attachmentParam }, ['recipients', 'subject', 'body']), risk: 'draft', inspect: (i: CreateInput) => ({ attachments: i.attachments ?? [], paths: i.attachments ?? [] }), preview: (i: CreateInput) => `New draft to ${i.recipients.length} people: '${i.subject.slice(0, 80)}' (stays in your Gmail Drafts)`, execute: (input: CreateInput, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      const to = addresses(input.recipients); const cc = addresses(input.cc_recipients ?? [], true);
      if (to.length + cc.length > 10) return error('TOO_MANY_RECIPIENTS');
      if (input.subject.length > 200 || input.body.length > 20_000) return error('DRAFT_TOO_LONG');
      const subject = header(input.subject);
      const attachments = await localAttachments(deps, input.attachments);
      const draft = await deps.google.gmail.createDraft({ raw: mime({ recipients: to, cc, subject, body: input.body, attachments }) });
      return saveDraft(draft, subject, to.length + cc.length, ctx);
    }) },
    { name: 'gmail_reply_draft', description: 'Create a threaded reply draft; recipients come from the thread.', parameters: schema({ thread_id: string, body: { ...string, maxLength: 20_000 }, reply_all: { type: 'boolean' }, attachments: attachmentParam }, ['thread_id', 'body']), risk: 'draft', inspect: (i: ReplyInput) => ({ attachments: i.attachments ?? [], paths: i.attachments ?? [] }), preview: () => 'Create reply draft (stays in your Gmail Drafts)', execute: (input: ReplyInput, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      if (input.body.length > 20_000) return error('DRAFT_TOO_LONG');
      const own = address(await deps.google.whoAmI());
      const thread = await deps.google.gmail.getThread(input.thread_id);
      const last = thread.messages.at(-1);
      if (!last) return error('THREAD_EMPTY');
      const from = parseAddresses(getHeader(last, 'From') ?? last.from);
      const ownLast = from.some(a => a.toLowerCase() === own.toLowerCase());
      const primary = parseAddresses(ownLast ? getHeader(last, 'To') : getHeader(last, 'Reply-To') ?? getHeader(last, 'From') ?? last.from).filter(a => a.toLowerCase() !== own.toLowerCase());
      const extra = input.reply_all ? parseAddresses(getHeader(last, 'Cc')).filter(a => a.toLowerCase() !== own.toLowerCase() && !primary.some(p => p.toLowerCase() === a.toLowerCase())) : [];
      if (!primary.length || primary.length + extra.length > 10) return error('INVALID_RECIPIENT');
      const messageId = header(getHeader(last, 'Message-ID') ?? '');
      const references = header([getHeader(last, 'References'), messageId].filter(Boolean).join(' '));
      const subject = header(/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`);
      const attachments = await localAttachments(deps, input.attachments);
      const draft = await deps.google.gmail.createDraft({ threadId: thread.id, raw: mime({ recipients: primary, cc: extra, subject, body: input.body, replyId: messageId, references, attachments }) });
      return saveDraft(draft, subject, primary.length + extra.length, ctx);
    }) },
    { name: 'gmail_update_draft', description: 'Update an unchanged Pixel-owned draft.', parameters: schema({ draft_id: string, subject: string, body: string }, ['draft_id']), risk: 'draft', preview: () => 'Edit a draft in Gmail Drafts', execute: (input: UpdateInput, ctx) => guard(async () => {
      if (!await connected()) return error('NOT_CONNECTED');
      const row = await deps.registry.get('draft', input.draft_id);
      if (!row || row.state !== 'waiting') return error('NOT_ADE_DRAFT');
      const current = await deps.google.gmail.getDraft(input.draft_id);
      if (current.messageId !== row.messageId) return error('DRAFT_CHANGED_BY_USER');
      if (input.subject === undefined && input.body === undefined) return error('NO_CHANGES');
      const message = await deps.google.gmail.getMessage(current.messageId);
      const to = addresses(parseAddresses(getHeader(message, 'To')));
      const cc = addresses(parseAddresses(getHeader(message, 'Cc')), true);
      const subject = header(input.subject ?? message.subject);
      if (subject.length > 200 || (input.body ?? message.textBody).length > 20_000) return error('DRAFT_TOO_LONG');
      if (message.attachments.length > 5 || message.attachments.some(a => BLOCKED.has(extname(a.filename).toLowerCase()))) return error('ATTACHMENT_TYPE_DENIED');
      if (message.attachments.reduce((sum, a) => sum + a.size, 0) > MAX_DRAFT_BYTES) return error('ATTACHMENT_TOO_LARGE');
      const attachments = await Promise.all(message.attachments.map(async a => ({ name: a.filename, bytes: await deps.google.gmail.getAttachment(message.id, a.id) })));
      if (attachments.reduce((sum, a) => sum + a.bytes.byteLength, 0) > MAX_DRAFT_BYTES) return error('ATTACHMENT_TOO_LARGE');
      const updated = await deps.google.gmail.updateDraft(input.draft_id, { threadId: current.threadId, raw: mime({ recipients: to, cc, subject, body: input.body ?? message.textBody, attachments }) });
      await deps.registry.record({ ...row, messageId: updated.messageId, subject });
      return { draft_id: updated.id, openUrl };
    }) },
  ];
}
