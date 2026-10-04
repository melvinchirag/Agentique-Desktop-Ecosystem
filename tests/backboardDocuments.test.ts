import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackboardDocuments, SUPPORTED_EXTENSIONS } from '../src/main/sponsors/backboardDocuments';

type Reply = { status?: number; json?: unknown } | Error;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function file(name: string, content: string | Buffer = 'hello'): string {
  const d = mkdtempSync(join(tmpdir(), 'ade-docs-'));
  dirs.push(d);
  const p = join(d, name);
  writeFileSync(p, content);
  return p;
}
function setup(replies: Reply[]) {
  const calls: { url: string; method: string; headers: any; body: any }[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const fetchFn = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body });
    const reply = replies.shift();
    if (!reply) throw new Error('no reply scripted');
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  const docs = new BackboardDocuments({ apiKey: 'test-key', fetch: fetchFn, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  return { docs, calls, sleeps };
}

describe('uploadToThread', () => {
  it('posts the file as multipart to the thread and returns the document id', async () => {
    const { docs, calls } = setup([{ json: { document_id: 'doc-1', filename: 'syllabus.pdf', status: 'pending' } }]);
    expect(await docs.uploadToThread('thread 1', file('syllabus.pdf', '%PDF-1.3'))).toEqual({ documentId: 'doc-1' });
    expect(calls[0]!.url).toBe('https://app.backboard.io/api/threads/thread%201/documents');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['X-API-Key']).toBe('test-key');
    const part = (calls[0]!.body as FormData).get('file') as File;
    expect(part.name).toBe('syllabus.pdf');
    expect(await part.text()).toBe('%PDF-1.3');
  });

  it('rejects an unsupported type before sending anything', async () => {
    const { docs, calls } = setup([]);
    await expect(docs.uploadToThread('t', file('setup.exe'))).rejects.toThrow(/UNSUPPORTED_TYPE/);
    await expect(docs.uploadToThread('t', file('README'))).rejects.toThrow(/UNSUPPORTED_TYPE/);
    expect(calls).toHaveLength(0);
  });

  it('the extension check ignores case', async () => {
    const { docs } = setup([{ json: { document_id: 'd' } }]);
    expect(await docs.uploadToThread('t', file('NOTES.PDF'))).toEqual({ documentId: 'd' });
  });

  it('rejects a file over 20 MB before sending anything', async () => {
    const { docs, calls } = setup([]);
    await expect(docs.uploadToThread('t', file('big.txt', Buffer.alloc(20 * 1024 * 1024 + 1)))).rejects.toThrow(/TOO_LARGE/);
    expect(calls).toHaveLength(0);
  });

  it('a Backboard error carries the status and body', async () => {
    const { docs } = setup([{ status: 400, json: { detail: "File type '.xyz' is not supported" } }]);
    await expect(docs.uploadToThread('t', file('a.txt'))).rejects.toMatchObject({ name: 'BackboardError', status: 400 });
  });

  it('a missing file rejects', async () => {
    const { docs } = setup([]);
    await expect(docs.uploadToThread('t', '/nope/missing.pdf')).rejects.toThrow();
  });

  it('knows the common document types', () => {
    for (const ext of ['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv']) expect(SUPPORTED_EXTENSIONS.has(ext)).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has('.exe')).toBe(false);
  });
});

describe('waitIndexed', () => {
  it('polls once a second until indexed and returns the chunk count', async () => {
    const { docs, calls, sleeps } = setup([{ json: { status: 'pending' } }, { json: { status: 'processing' } }, { json: { status: 'indexed', chunk_count: 40 } }]);
    expect(await docs.waitIndexed('doc 1', 60_000)).toEqual({ status: 'indexed', chunks: 40 });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe('https://app.backboard.io/api/documents/doc%201/status');
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('a failed document is an error at once', async () => {
    const { docs, calls } = setup([{ json: { status: 'failed', status_message: 'could not parse' } }]);
    expect(await docs.waitIndexed('d', 60_000)).toEqual({ status: 'error', chunks: 0 });
    expect(calls).toHaveLength(1);
  });

  it('gives up at the timeout', async () => {
    const { docs, calls } = setup(Array.from({ length: 10 }, () => ({ json: { status: 'pending' } })));
    expect(await docs.waitIndexed('d', 3000)).toEqual({ status: 'error', chunks: 0 });
    expect(calls).toHaveLength(4);                          // at 0, 1, 2, 3 s
  });

  it('never waits longer than 60 s, whatever timeout is asked for', async () => {
    const { docs, sleeps } = setup(Array.from({ length: 100 }, () => ({ json: { status: 'pending' } })));
    await docs.waitIndexed('d', 10 * 60_000);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(60_000);
  });

  it('keeps polling through a network hiccup and a 5xx', async () => {
    const { docs } = setup([new TypeError('fetch failed'), { status: 503 }, { json: { status: 'indexed', chunk_count: 8 } }]);
    expect(await docs.waitIndexed('d', 60_000)).toEqual({ status: 'indexed', chunks: 8 });
  });

  it('a 404 is an error and does not throw', async () => {
    const { docs } = setup([{ status: 404, json: { detail: 'not found' } }]);
    expect(await docs.waitIndexed('d', 60_000)).toEqual({ status: 'error', chunks: 0 });
  });

  it('a missing chunk count is 0', async () => {
    const { docs } = setup([{ json: { status: 'indexed', chunk_count: null } }]);
    expect(await docs.waitIndexed('d', 60_000)).toEqual({ status: 'indexed', chunks: 0 });
  });
});
