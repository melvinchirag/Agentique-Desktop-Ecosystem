import type { GmailApi, GmailDraft, GmailMessage, GmailMessageSummary, GmailThread } from './api';
import type { GmailPayload } from './mimeParse';
import { decodeBase64Url, parseGmailPayload } from './mimeParse';
import { GoogleHttp } from './http';

const base = 'https://gmail.googleapis.com';
type WireMessage = { id: string; threadId: string; snippet?: string; labelIds?: string[]; internalDate?: string; payload?: GmailPayload };
type WireDraft = { id: string; message?: { id?: string; threadId?: string } };

function idPart(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('BAD_ID');
  return id;
}

function queryUrl(path: string, params: Record<string, string | number | undefined>): URL {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
  return url;
}

function summary(message: WireMessage): GmailMessageSummary {
  const parsed = message.payload ? parseGmailPayload({ headers: message.payload.headers }) : undefined;
  return {
    id: message.id, threadId: message.threadId, snippet: message.snippet ?? '',
    labels: message.labelIds ?? [], internalDate: Number(message.internalDate ?? 0),
    from: parsed?.headers.from ?? '', subject: parsed?.headers.subject ?? '',
  };
}

function fullMessage(message: WireMessage): GmailMessage {
  const parsed = parseGmailPayload(message.payload ?? {});
  return {
    ...summary(message), headers: parsed.headers, textBody: parsed.textBody,
    ...(parsed.htmlBody ? { htmlBody: parsed.htmlBody } : {}),
    attachments: parsed.attachments.filter((part) => part.attachmentId).map((part) => ({
      id: part.attachmentId!, filename: part.filename, mimeType: part.mimeType, size: part.size,
    })),
  };
}

function draft(value: WireDraft): GmailDraft {
  return { id: value.id, messageId: value.message?.id ?? '', ...(value.message?.threadId ? { threadId: value.message.threadId } : {}) };
}

export class GmailClient implements GmailApi {
  constructor(private readonly http: GoogleHttp) {}

  private async json<T>(method: string, url: URL | string, init?: Omit<RequestInit, 'method' | 'signal'>): Promise<T> {
    return await (await this.http.request(method, url, init)).json() as T;
  }

  private async list(query: string, maxResults: number): Promise<GmailMessageSummary[]> {
    const limit = Math.max(1, Math.min(100, Math.floor(maxResults)));
    const page = await this.json<{ messages?: Array<{ id: string }> }>('GET', queryUrl('/gmail/v1/users/me/messages', { q: query, maxResults: limit }));
    return Promise.all((page.messages ?? []).map(async ({ id }) => summary(await this.json<WireMessage>('GET', queryUrl(`/gmail/v1/users/me/messages/${idPart(id)}`, { format: 'metadata' })))));
  }

  search(query: string, maxResults = 25): Promise<GmailMessageSummary[]> { return this.list(query, maxResults); }
  listSent(maxResults: number): Promise<GmailMessageSummary[]> { return this.list('in:sent', maxResults); }

  async getMessage(id: string): Promise<GmailMessage> {
    const wire = await this.json<WireMessage>('GET', queryUrl(`/gmail/v1/users/me/messages/${idPart(id)}`, { format: 'full' }));
    return fullMessage(wire);
  }

  async getThread(id: string): Promise<GmailThread> {
    const wire = await this.json<{ id: string; messages?: WireMessage[] }>('GET', queryUrl(`/gmail/v1/users/me/threads/${idPart(id)}`, { format: 'full' }));
    return { id: wire.id, messages: (wire.messages ?? []).map(fullMessage) };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
    const value = await this.json<{ data: string }>('GET', `${base}/gmail/v1/users/me/messages/${idPart(messageId)}/attachments/${idPart(attachmentId)}`);
    return decodeBase64Url(value.data);
  }

  private async upload(method: 'POST' | 'PUT', path: string, input: { raw: string; threadId?: string }): Promise<GmailDraft> {
    const boundary = `ade_${crypto.randomUUID().replace(/-/g, '')}`;
    const metadata = { message: input.threadId ? { threadId: idPart(input.threadId) } : {} };
    const body = [
      `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata),
      `--${boundary}`, 'Content-Type: message/rfc822', '', input.raw.replace(/\r?\n/g, '\r\n'),
      `--${boundary}--`, '',
    ].join('\r\n');
    const value = await this.json<WireDraft>(method, queryUrl(path, { uploadType: 'multipart' }), {
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    return draft(value);
  }

  createDraft(input: { raw: string; threadId?: string }): Promise<GmailDraft> {
    return this.upload('POST', '/upload/gmail/v1/users/me/drafts', input);
  }
  updateDraft(draftId: string, input: { raw: string; threadId?: string }): Promise<GmailDraft> {
    return this.upload('PUT', `/upload/gmail/v1/users/me/drafts/${idPart(draftId)}`, input);
  }
  async getDraft(draftId: string): Promise<GmailDraft> {
    return draft(await this.json<WireDraft>('GET', `${base}/gmail/v1/users/me/drafts/${idPart(draftId)}`));
  }
  async listDrafts(maxResults = 25): Promise<GmailDraft[]> {
    const page = await this.json<{ drafts?: WireDraft[] }>('GET', queryUrl('/gmail/v1/users/me/drafts', { maxResults: Math.max(1, Math.min(100, Math.floor(maxResults))) }));
    return (page.drafts ?? []).map(draft);
  }
}
