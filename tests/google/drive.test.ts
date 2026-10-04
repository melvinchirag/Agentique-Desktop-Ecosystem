import { describe, expect, it } from 'vitest';
import { DriveClient } from '../../src/main/connectors/google/driveClient';
import type { GoogleTransport } from '../../src/main/connectors/google/calendarClient';

function transport(responses: Response[]) {
  const calls: Array<{ method: string; url: URL }> = [];
  const http: GoogleTransport = { async request(method, input) {
    calls.push({ method, url: new URL(input) });
    return responses.shift() ?? Response.json({});
  } };
  return { client: new DriveClient(http, () => Date.parse('2026-10-04T12:00:00Z')), calls };
}

describe('DriveClient', () => {
  it('escapes Drive literals, excludes trash, and applies structured filters', async () => {
    const { client, calls } = transport([Response.json({ files: [{ id: 'd1', name: 'Report', mimeType: 'application/vnd.google-apps.document', size: '42' }] })]);
    const files = await client.search({ text: "quinn's \\essay", kind: 'doc', modifiedWithinDays: 2 });
    expect(files).toEqual([{ id: 'd1', name: 'Report', mimeType: 'application/vnd.google-apps.document', kind: 'doc', size: 42 }]);
    const q = calls[0]!.url.searchParams.get('q')!;
    expect(q).toContain('trashed = false');
    expect(q).toContain("name contains 'quinn\\'s \\\\essay'");
    expect(q).toContain("mimeType = 'application/vnd.google-apps.document'");
    expect(q).toContain("modifiedTime > '2026-10-02T12:00:00.000Z'");
    expect(q).not.toContain("quinn's \\essay' or trashed");
  });

  it('gets metadata, exports text, and downloads bytes', async () => {
    const { client, calls } = transport([
      Response.json({ id: 'd1', name: 'A', mimeType: 'application/pdf' }),
      new Response('hello'), new Response(new Uint8Array([0, 1, 255])),
    ]);
    expect((await client.getFile('d1')).kind).toBe('pdf');
    expect(await client.exportText('d1')).toBe('hello');
    expect(await client.download('d1')).toEqual(new Uint8Array([0, 1, 255]));
    expect(calls[1]!.url.pathname).toBe('/drive/v3/files/d1/export');
    expect(calls[1]!.url.searchParams.get('mimeType')).toBe('text/plain');
    expect(calls[2]!.url.searchParams.get('alt')).toBe('media');
    await expect(client.getFile('../bad')).rejects.toThrow('BAD_ID');
  });
});
