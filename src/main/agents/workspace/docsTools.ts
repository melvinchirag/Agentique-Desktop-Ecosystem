import type { DocsRequest } from '../../connectors/google/api';
import type { ToolDefinition } from '../../../shared/tools';
import type { WorkspaceToolServices } from './calendarTools';

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (maxLength?: number) => ({ type: 'string', ...(maxLength ? { maxLength } : {}) });
const fail = (error: string) => ({ error });

interface InlinePart { text: string; bold?: boolean; link?: string }
interface TextStyle { start: number; end: number; style: Record<string, unknown> }

function inlineParts(value: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const token = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  for (const match of value.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: value.slice(cursor, index) });
    if (match[1] !== undefined) parts.push({ text: match[1], bold: true });
    else {
      let url: URL | undefined;
      try { url = new URL(match[3]); } catch { /* rejected below */ }
      if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('UNSUPPORTED_LINK');
      parts.push({ text: match[2], link: url.toString() });
    }
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts;
}

/** Convert the documented Markdown subset to one insert plus UTF-16 style ranges. */
export function markdownRequests(markdown: string, insertionIndex = 1): DocsRequest[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let text = '';
  const ranges: TextStyle[] = [];
  for (const sourceLine of lines) {
    let line = sourceLine;
    let paragraphStyle: Record<string, unknown> | undefined;
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { line = heading[2]; paragraphStyle = { namedStyleType: `HEADING_${heading[1].length}` }; }
    else if (/^[-*]\s+/.test(line)) { line = line.replace(/^[-*]\s+/, '• '); }
    else if (/^\d+\.\s+/.test(line)) { line = line.replace(/^(\d+)\.\s+/, '$1. '); }
    const start = insertionIndex + text.length;
    for (const part of inlineParts(line)) {
      const partStart = insertionIndex + text.length;
      text += part.text;
      if (part.bold) ranges.push({ start: partStart, end: insertionIndex + text.length, style: { bold: true } });
      if (part.link) ranges.push({ start: partStart, end: insertionIndex + text.length, style: { link: { url: part.link } } });
    }
    text += '\n';
    const end = insertionIndex + text.length;
    if (paragraphStyle && end > start + 1) ranges.push({ start, end: end - 1, style: { __paragraphStyle: paragraphStyle } });
  }
  const requests: DocsRequest[] = [{ insertText: { location: { index: insertionIndex }, text } }];
  for (const range of ranges) {
    if ('__paragraphStyle' in range.style) {
      requests.push({ updateParagraphStyle: { range: { startIndex: range.start, endIndex: range.end }, paragraphStyle: range.style.__paragraphStyle,
        fields: 'namedStyleType' } });
    } else {
      requests.push({ updateTextStyle: { range: { startIndex: range.start, endIndex: range.end }, textStyle: range.style,
        fields: Object.keys(range.style).join(',') } });
    }
  }
  return requests;
}

export function createDocsTools(services: WorkspaceToolServices): ToolDefinition[] {
  const create: ToolDefinition = {
    name: 'docs_create',
    description: 'Create a new private Google Doc using headings, paragraphs, lists, bold, and https links.',
    parameters: object({ title: string(200), body_markdown: string(60_000) }, ['title', 'body_markdown']),
    risk: 'draft',
    execute: async (input: { title: string; body_markdown: string }, ctx) => {
      const google = services.google(); if (!google) return fail('NOT_CONNECTED');
      if (!services.registerDoc) return fail('UNAVAILABLE');
      if (!input.title.trim() || input.body_markdown.length > 60_000) return fail('BAD_DOCUMENT');
      let requests: DocsRequest[];
      try { requests = markdownRequests(input.body_markdown); } catch (error) { return fail(error instanceof Error ? error.message : 'BAD_MARKDOWN'); }
      const created = await google.docs.create(input.title);
      try {
        await google.docs.batchUpdate(created.id, requests);
        await services.registerDoc({ id: created.id, title: created.title });
      } catch (error) {
        // The create endpoint makes a private, ADE-owned file; there is no permissions API to widen access.
        throw error;
      }
      ctx.emit({ type: 'artifact', agentId: ctx.agentId, kind: 'google_doc', title: created.title,
        data: { title: created.title }, openUrl: `https://docs.google.com/document/d/${encodeURIComponent(created.id)}/edit` });
      return { doc_id: created.id, title: created.title, paragraphs: input.body_markdown.split(/\r?\n/).filter(Boolean).length };
    },
  };

  const append: ToolDefinition = {
    name: 'docs_append',
    description: 'Append Markdown content to a Google Doc made by Pixel. Warden asks before the change.',
    parameters: object({ doc_id: string(), body_markdown: string(60_000) }, ['doc_id', 'body_markdown']),
    risk: 'write',
    preview: (input: { doc_id: string; body_markdown: string }) => `Add ${input.body_markdown.split(/\r?\n/).filter(Boolean).length} paragraphs to your Doc '${input.doc_id}'`,
    execute: async (input: { doc_id: string; body_markdown: string }) => {
      const google = services.google(); if (!google) return fail('NOT_CONNECTED');
      if (!services.isOwnedDoc || !(await services.isOwnedDoc(input.doc_id))) return fail('NOT_ADE_DOC');
      let requests: DocsRequest[];
      try { requests = markdownRequests(input.body_markdown, await google.docs.getEndIndex(input.doc_id) - 1); }
      catch (error) { return fail(error instanceof Error ? error.message : 'BAD_MARKDOWN'); }
      await google.docs.batchUpdate(input.doc_id, requests);
      return { doc_id: input.doc_id, paragraphs: input.body_markdown.split(/\r?\n/).filter(Boolean).length };
    },
  };
  return [create, append];
}
