import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertGoogleAllowed, BlockedRequestError } from '../../src/main/connectors/google/allowlist';

describe('P3 Google route allowlist', () => {
  it('allows only the named read and draft routes', () => {
    const allowed: Array<[string, string]> = [
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/profile'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/a_1'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/a/attachments/b'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/threads/a'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/a'],
      ['POST', 'https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts?uploadType=multipart'],
      ['PUT', 'https://gmail.googleapis.com/upload/gmail/v1/users/me/drafts/a?uploadType=multipart'],
      ['GET', 'https://www.googleapis.com/calendar/v3/calendars/primary/events'],
      ['POST', 'https://www.googleapis.com/calendar/v3/calendars/primary/events'],
      ['PATCH', 'https://www.googleapis.com/calendar/v3/calendars/primary/events/a'],
      ['GET', 'https://www.googleapis.com/drive/v3/files'],
      ['GET', 'https://www.googleapis.com/drive/v3/files/a/export'],
      ['POST', 'https://docs.googleapis.com/v1/documents'],
      ['GET', 'https://docs.googleapis.com/v1/documents/a'],
      ['POST', 'https://docs.googleapis.com/v1/documents/a:batchUpdate'],
      ['GET', 'https://sheets.googleapis.com/v4/spreadsheets/a'],
      ['GET', 'https://sheets.googleapis.com/v4/spreadsheets/a/values/Sheet1%21A1%3AB2'],
    ];
    for (const [method, url] of allowed) expect(() => assertGoogleAllowed(method, url)).not.toThrow();
  });

  it('blocks unsafe endpoints and host/path tricks', () => {
    const denied: Array<[string, string]> = [
      ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'],
      ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send'],
      ['DELETE', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/a'],
      ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/a/trash'],
      ['POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/a/modify'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters'],
      ['POST', 'https://www.googleapis.com/drive/v3/files/a/permissions'],
      ['DELETE', 'https://www.googleapis.com/drive/v3/files/a'],
      ['DELETE', 'https://www.googleapis.com/calendar/v3/calendars/primary/events/a'],
      ['GET', 'https://gmail.googleapis.com.evil.test/gmail/v1/users/me/messages'],
      ['GET', 'http://gmail.googleapis.com/gmail/v1/users/me/messages'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/a%2Fb'],
      ['GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/a/extra'],
    ];
    for (const [method, url] of denied) expect(() => assertGoogleAllowed(method, url)).toThrow(BlockedRequestError);
  });

  it('P3 source grep finds no forbidden operation outside the deny table', () => {
    const roots = ['src/main/connectors/google', 'src/main/agents/workspace'];
    const files = roots.flatMap((root) => readdirSync(root, { recursive: true })
      .filter((name) => String(name).endsWith('.ts')).map((name) => join(root, String(name))));
    const offenders = files.filter((file) => {
      if (file.endsWith('allowlist.ts')) return false;
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
      return /\b(?:send|permissions)\b|\.delete\s*\(/i.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
