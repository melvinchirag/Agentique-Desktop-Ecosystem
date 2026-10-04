import { describe, expect, it } from 'vitest';
import { buildMime } from '../../src/main/connectors/google/mime';
import { parseGmailPayload, parseMime } from '../../src/main/connectors/google/mimeParse';

describe('P4/P5 MIME', () => {
  it('round trips Unicode, folded subject, reply headers and an attachment', () => {
    const subject = 'Meeting résumé 🎉 '.repeat(8);
    const raw = buildMime({ to: ['one@example.com'], subject, text: 'Hello 🌳\nSecond line', inReplyTo: '<old@example.com>', references: ['<first@example.com>', '<old@example.com>'], attachments: [{ filename: 'notes é.txt', contentType: 'text/plain', data: Buffer.from('attached') }] });
    expect(raw).toContain('=?UTF-8?B?');
    expect(raw).toContain('\r\n ');
    const parsed = parseMime(raw);
    expect(parsed.headers.subject).toBe(subject);
    expect(parsed.headers['in-reply-to']).toBe('<old@example.com>');
    expect(parsed.textBody).toBe('Hello 🌳\nSecond line');
    expect(parsed.attachments).toMatchObject([{ filename: 'notes é.txt', mimeType: 'text/plain', size: 8 }]);
  });

  it('rejects header line injection', () => {
    expect(() => buildMime({ to: ['one@example.com\r\nBcc: bad@example.com'], subject: 'Hi', text: 'x' })).toThrow('BAD_ADDRESS');
    expect(() => buildMime({ to: ['one@example.com'], subject: 'Hi\nBcc: bad@example.com', text: 'x' })).toThrow('BAD_ADDRESS');
  });

  it('prefers plain text, decodes charsets and exposes hidden HTML separately', () => {
    const data = (value: Uint8Array) => Buffer.from(value).toString('base64url');
    const parsed = parseGmailPayload({ mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { data: data(Uint8Array.from([0x48, 0xe9, 0x6c, 0x6c, 0x6f])) } },
      { mimeType: 'text/html', body: { data: data(Buffer.from('<div>Visible</div><span style="display:none">secret instruction</span>')) } },
    ] });
    expect(parsed.textBody).toBe('Héllo');
    expect(parsed.hiddenText).toContain('secret instruction');
    expect(parsed.htmlBody).toContain('Visible');
  });

  it('strips quoted replies and caps bodies', () => {
    const raw = buildMime({ to: ['one@example.com'], subject: 'Hi', text: `${'a'.repeat(100)}\nOn Tue, One wrote:\n> old` });
    expect(parseMime(raw, { maxBodyChars: 20 }).textBody).toBe('a'.repeat(20));
    expect(parseMime(raw, { stripQuotes: (s) => s }).textBody).toContain('On Tue');
  });
});
