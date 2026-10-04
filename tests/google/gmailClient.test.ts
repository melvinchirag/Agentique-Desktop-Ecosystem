import { describe, expect, it, vi } from 'vitest';
import { GoogleHttp } from '../../src/main/connectors/google/http';
import { GmailClient } from '../../src/main/connectors/google/gmailClient';

function client(fetcher: typeof fetch): GmailClient {
  return new GmailClient(new GoogleHttp({ fetch: fetcher, getAccessToken: async () => 'token', refreshAccessToken: async () => 'fresh' }));
}
function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200 }); }

describe('GmailClient', () => {
  it('searches, reads messages and threads, and decodes attachments', async () => {
    const wire = { id: 'm1', threadId: 't1', snippet: 'Hello', labelIds: ['INBOX'], internalDate: '1000', payload: { headers: [{ name: 'From', value: 'one@example.com' }, { name: 'Subject', value: 'Hi' }], mimeType: 'text/plain', body: { data: Buffer.from('Hello').toString('base64url') } } };
    const fetcher = vi.fn((url: URL) => {
      if (url.pathname.endsWith('/messages')) return Promise.resolve(json({ messages: [{ id: 'm1' }] }));
      if (url.pathname.endsWith('/messages/m1')) return Promise.resolve(json(wire));
      if (url.pathname.endsWith('/threads/t1')) return Promise.resolve(json({ id: 't1', messages: [wire] }));
      return Promise.resolve(json({ data: Buffer.from('file').toString('base64url') }));
    }) as unknown as typeof fetch;
    const gmail = client(fetcher);
    expect(await gmail.search('from:one@example.com')).toMatchObject([{ id: 'm1', from: 'one@example.com', subject: 'Hi' }]);
    expect((await gmail.getMessage('m1')).textBody).toBe('Hello');
    expect((await gmail.getThread('t1')).messages).toHaveLength(1);
    expect(Buffer.from(await gmail.getAttachment('m1', 'a1')).toString()).toBe('file');
    await gmail.listSent(2);
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => (url as URL).searchParams.get('q') === 'in:sent')).toBe(true);
  });

  it('uses multipart draft upload with message threadId and RFC 5322 data', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ id: 'd1', message: { id: 'm2', threadId: 't1' } })).mockResolvedValueOnce(json({ id: 'd1', message: { id: 'm3', threadId: 't1' } }));
    const gmail = client(fetcher);
    const raw = 'To: one@example.com\r\nSubject: Re: Hi\r\n\r\nHello';
    expect(await gmail.createDraft({ raw, threadId: 't1' })).toEqual({ id: 'd1', messageId: 'm2', threadId: 't1' });
    expect(await gmail.updateDraft('d1', { raw, threadId: 't1' })).toEqual({ id: 'd1', messageId: 'm3', threadId: 't1' });
    for (const [url, init] of fetcher.mock.calls as Array<[URL, RequestInit]>) {
      expect(url.searchParams.get('uploadType')).toBe('multipart');
      expect(new Headers(init.headers).get('Content-Type')).toContain('multipart/related');
      expect(init.body).toContain('{"message":{"threadId":"t1"}}');
      expect(init.body).toContain('Content-Type: message/rfc822');
      expect(init.body).toContain(raw);
    }
  });

  it('gets and lists drafts', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ id: 'd1', message: { id: 'm1' } })).mockResolvedValueOnce(json({ drafts: [{ id: 'd1', message: { id: 'm1' } }] }));
    const gmail = client(fetcher);
    expect((await gmail.getDraft('d1')).messageId).toBe('m1');
    expect(await gmail.listDrafts()).toHaveLength(1);
  });
});
