import { describe, expect, it } from 'vitest';
import { DocsClient } from '../../src/main/connectors/google/docsClient';
import type { GoogleTransport } from '../../src/main/connectors/google/calendarClient';

it('creates, batches updates, and reads the document end index through GoogleHttp', async () => {
  const calls: Array<{ method: string; url: URL; body?: unknown }> = [];
  const replies = [Response.json({ documentId: 'doc_1', title: 'Report' }), Response.json({}), Response.json({ body: { content: [{ endIndex: 1 }, { endIndex: 23 }] } })];
  const http: GoogleTransport = { async request(method, input, init) {
    calls.push({ method, url: new URL(input), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return replies.shift() ?? Response.json({});
  } };
  const client = new DocsClient(http);
  expect(await client.create('Report')).toEqual({ id: 'doc_1', title: 'Report' });
  await client.batchUpdate('doc_1', [{ insertText: { location: { index: 1 }, text: 'Hello\n' } }]);
  expect(await client.getEndIndex('doc_1')).toBe(23);
  expect(calls.map(({ method }) => method)).toEqual(['POST', 'POST', 'GET']);
  expect(calls[1]!.url.pathname).toBe('/v1/documents/doc_1:batchUpdate');
  expect(calls[1]!.body).toEqual({ requests: [{ insertText: { location: { index: 1 }, text: 'Hello\n' } }] });
  expect(calls[2]!.url.searchParams.get('fields')).toBe('body(content(endIndex))');
  await expect(client.batchUpdate('../bad', [])).rejects.toThrow('BAD_ID');
});
