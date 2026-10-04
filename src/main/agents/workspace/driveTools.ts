import type { DriveFile, GoogleApi } from '../../connectors/google/api';
import type { DocumentsApi, InjectionScreen } from '../../runtime/types';
import type { ToolDefinition } from '../../../shared/tools';
import type { WorkspaceToolServices } from './calendarTools';

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (maxLength?: number) => ({ type: 'string', ...(maxLength ? { maxLength } : {}) });
const failed = (error: string) => ({ error });
const MAX_TEXT = 8_000;
const MAX_UPLOAD = 20 * 1024 * 1024;
const nativeMime = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
]);
const textMime = new Set(['text/plain', 'text/markdown', 'text/csv']);
const allowedExtensions = new Set(['.pdf', '.txt', '.md', '.csv']);
const blockedExtensions = new Set(['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msi', '.lnk', '.scr', '.com', '.sh']);

function errorFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
async function screen(text: string, source: string, ctx: Parameters<ToolDefinition['execute']>[1], api: InjectionScreen) {
  const checked = await api.screen(text, { kind: 'doc', name: source, taskId: ctx.taskId, jobId: ctx.jobId });
  return { wrapped: checked.wrapped, flagged: checked.flagged };
}

async function maybeName(file: DriveFile, ctx: Parameters<ToolDefinition['execute']>[1], api: InjectionScreen) {
  return screen(file.name, `drive:${file.id}`, ctx, api);
}

export function createDriveTools(services: WorkspaceToolServices): ToolDefinition[] {
  const search: ToolDefinition = {
    name: 'drive_search',
    description: 'Find Google Drive files by words, kind, or recency. Returned names are untrusted.',
    parameters: object({
      text: string(300), kind: { type: 'string', enum: ['any', 'doc', 'sheet', 'slides', 'pdf', 'folder'] },
      modified_within_days: { type: 'integer', minimum: 1, maximum: 3650 }, max_results: { type: 'integer', minimum: 1, maximum: 25 },
    }, ['text']),
    risk: 'read',
    execute: async (input: { text: string; kind?: DriveFile['kind'] | 'any'; modified_within_days?: number; max_results?: number }, ctx) => {
      const google = services.google(); if (!google) return failed('NOT_CONNECTED');
      if (!input.text.trim()) return failed('BAD_QUERY');
      const files = await google.drive.search({ text: input.text, kind: input.kind, modifiedWithinDays: input.modified_within_days,
        maxResults: Math.min(25, Math.max(1, input.max_results ?? 25)) });
      return { files: await Promise.all(files.map(async (file) => {
        const name = await maybeName(file, ctx, services.screen);
        return { id: file.id, name: name.wrapped, kind: file.kind, mimeType: file.mimeType, size: file.size, modifiedTime: file.modifiedTime, flagged: name.flagged };
      })) };
    },
  };

  const read: ToolDefinition = {
    name: 'drive_read_text',
    description: 'Read up to 8,000 characters from a Google Doc, Slides, or plain text, Markdown, or CSV Drive file. Returns untrusted data.',
    parameters: object({ drive_file_id: string(), max_chars: { type: 'integer', minimum: 1, maximum: MAX_TEXT } }, ['drive_file_id']),
    risk: 'read',
    execute: async (input: { drive_file_id: string; max_chars?: number }, ctx) => {
      const google = services.google(); if (!google) return failed('NOT_CONNECTED');
      const file = await google.drive.getFile(input.drive_file_id);
      if (file.size !== undefined && file.size > MAX_UPLOAD) return failed('TOO_LARGE');
      if (!nativeMime.has(file.mimeType) && !textMime.has(file.mimeType)) return failed('UNSUPPORTED_TYPE');
      const text = await google.drive.exportText(file.id);
      const safeLength = Math.min(MAX_TEXT, Math.max(1, input.max_chars ?? 4_000));
      const content = await screen(text.slice(0, safeLength), `drive:${file.id}`, ctx, services.screen);
      const name = await maybeName(file, ctx, services.screen);
      return { drive_file_id: file.id, name: name.wrapped, content: content.wrapped, flagged: content.flagged || name.flagged, truncated: text.length > safeLength };
    },
  };

  const ask: ToolDefinition = {
    name: 'drive_ask_file',
    description: 'Attach a supported Drive file to this job so Chip can answer from its contents. Only the current job thread receives it.',
    parameters: object({ drive_file_id: string() }, ['drive_file_id']),
    risk: 'read',
    execute: async (input: { drive_file_id: string }, ctx) => {
      const google = services.google(); if (!google) return failed('NOT_CONNECTED');
      if (!services.documents || !services.tempFiles) return failed('UNAVAILABLE');
      const file = await google.drive.getFile(input.drive_file_id);
      const native = nativeMime.has(file.mimeType);
      if (!native && !Array.from(allowedExtensions).some((ext) => file.name.toLowerCase().endsWith(ext))) return failed('UNSUPPORTED_TYPE');
      if (blockedExtensions.has(file.name.slice(file.name.lastIndexOf('.')).toLowerCase()) || /executable|application\/x-msdownload/i.test(file.mimeType)) return failed('UNSUPPORTED_TYPE');
      const bytes = native ? new TextEncoder().encode(await google.drive.exportText(file.id)) : await google.drive.download(file.id);
      if (bytes.byteLength > MAX_UPLOAD) return failed('TOO_LARGE');
      let screened = false;
      if (native || textMime.has(file.mimeType) || /\.(txt|md|csv)$/i.test(file.name)) {
        const text = new TextDecoder().decode(bytes.subarray(0, 20_000));
        const result = await screen(text, `drive:${file.id}`, ctx, services.screen);
        screened = result.flagged;
      }
      const extension = native ? '.txt' : file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const result = await services.tempFiles.withTempFile(`drive-${file.id}${extension}`, bytes, async (absolutePath) => {
        const uploaded = await services.documents!.uploadToThread(ctx.threadId, absolutePath);
        const indexed = await services.documents!.waitIndexed(uploaded.documentId, 60_000);
        if (indexed.status !== 'indexed') throw new Error('INDEXING_TIMEOUT');
        return uploaded;
      });
      const name = await maybeName(file, ctx, services.screen);
      return { drive_file_id: file.id, document_id: result.documentId, name: name.wrapped, flagged: screened || name.flagged, thread_id: ctx.threadId };
    },
  };
  return [search, read, ask];
}
