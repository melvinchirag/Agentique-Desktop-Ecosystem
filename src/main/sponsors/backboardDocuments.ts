import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { DocumentsApi } from '../runtime/types';
import { BackboardError } from '../runtime/backboard';

const BASE_URL = 'https://app.backboard.io/api';
const MAX_BYTES = 20 * 1024 * 1024;          // 02-archie-files.md §4.1 (Backboard's own limit is not confirmed)
const MAX_WAIT_MS = 60_000;
const POLL_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Extensions Backboard accepts for thread documents (from the API's own error message, docs/sponsor-verify.md §A2). */
export const SUPPORTED_EXTENSIONS = new Set(['.aac', '.avi', '.bmp', '.c', '.cpp', '.css', '.csv', '.doc', '.docx', '.flac', '.gif', '.go', '.h', '.html',
  '.java', '.jpeg', '.jpg', '.js', '.json', '.jsonl', '.jsx', '.m4a', '.markdown', '.md', '.mkv', '.mov', '.mp3', '.mp4', '.mpeg', '.mpg', '.ogg', '.pdf',
  '.php', '.png', '.ppt', '.pptx', '.py', '.rb', '.rs', '.sql', '.tif', '.tiff', '.ts', '.tsx', '.txt', '.wav', '.webm', '.webp', '.xls', '.xlsx', '.xml']);

export interface BackboardDocumentsOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Thread documents for Archie's fs_ask_file (02-archie-files.md §4.1).
 * Files go to the JOB THREAD only, never to the assistant, so private files do not pile up (SPONSORS §2.5).
 */
export class BackboardDocuments implements DocumentsApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(opts: BackboardDocumentsOptions) {
    if (!opts.apiKey) throw new Error('BACKBOARD_API_KEY is missing');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  /** Uploads one file to a thread. Rejects unsupported types and files over 20 MB before sending anything. */
  async uploadToThread(threadId: string, absPath: string): Promise<{ documentId: string }> {
    const ext = extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error(`UNSUPPORTED_TYPE: Backboard cannot read "${ext || 'no extension'}" files`);
    const { size } = await stat(absPath);
    if (size > MAX_BYTES) throw new Error(`TOO_LARGE: ${basename(absPath)} is over 20 MB`);
    const form = new FormData();
    form.set('file', new Blob([await readFile(absPath)]), basename(absPath));
    const path = `/threads/${encodeURIComponent(threadId)}/documents`;
    const res = await this.fetchFn(this.baseUrl + path, { method: 'POST', headers: { 'X-API-Key': this.apiKey }, body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await res.text();
    if (!res.ok) throw new BackboardError(res.status, text, path);
    const documentId = (JSON.parse(text) as { document_id?: string }).document_id;
    if (!documentId) throw new Error('Backboard did not return a document_id');
    return { documentId };
  }

  /**
   * Polls once a second until the document is indexed. Waits at most `timeoutMs`, capped at 60 s.
   * Never throws: a failed document, a timeout, or a network error all come back as status 'error'.
   */
  async waitIndexed(documentId: string, timeoutMs: number): Promise<{ status: 'indexed' | 'error'; chunks: number }> {
    const deadline = this.now() + Math.min(Math.max(0, timeoutMs), MAX_WAIT_MS);
    const path = `/documents/${encodeURIComponent(documentId)}/status`;
    for (;;) {
      try {
        const res = await this.fetchFn(this.baseUrl + path, { headers: { 'X-API-Key': this.apiKey }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (res.ok) {
          const body = (await res.json()) as { status?: string; chunk_count?: number | null };
          if (body.status === 'indexed') return { status: 'indexed', chunks: body.chunk_count ?? 0 };
          if (body.status !== 'pending' && body.status !== 'processing') return { status: 'error', chunks: 0 };
        } else if (res.status < 500) return { status: 'error', chunks: 0 };      // e.g. 404: it will not get better
      } catch { /* network hiccup: keep polling until the deadline */ }
      if (this.now() + POLL_MS > deadline) return { status: 'error', chunks: 0 };
      await this.sleep(POLL_MS);
    }
  }
}
