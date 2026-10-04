import type { DocsApi, DocsRequest } from './api';
import type { GoogleTransport } from './calendarClient';

const base = 'https://docs.googleapis.com/v1/documents';
function idPart(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('BAD_ID');
  return id;
}

export class DocsClient implements DocsApi {
  constructor(private readonly http: GoogleTransport) {}

  async create(title: string): Promise<{ id: string; title: string }> {
    const response = await this.http.request('POST', base, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    });
    const doc = await response.json() as { documentId: string; title: string };
    return { id: doc.documentId, title: doc.title };
  }

  async batchUpdate(docId: string, requests: DocsRequest[]): Promise<void> {
    await this.http.request('POST', `${base}/${idPart(docId)}:batchUpdate`, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
    });
  }

  async getEndIndex(docId: string): Promise<number> {
    const url = new URL(`${base}/${idPart(docId)}`);
    url.searchParams.set('fields', 'body(content(endIndex))');
    const doc = await (await this.http.request('GET', url)).json() as { body?: { content?: Array<{ endIndex?: number }> } };
    const end = doc.body?.content?.at(-1)?.endIndex;
    if (typeof end !== 'number' || !Number.isInteger(end) || end < 1) throw new Error('BAD_DOC_END_INDEX');
    return end;
  }
}
