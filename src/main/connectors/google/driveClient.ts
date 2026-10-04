import type { DriveApi, DriveFile, DriveFileKind } from './api';
import type { GoogleTransport } from './calendarClient';

type WireFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string };
const base = 'https://www.googleapis.com/drive/v3/files';
const mimeByKind: Partial<Record<DriveFileKind, string>> = {
  doc: 'application/vnd.google-apps.document', sheet: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation', pdf: 'application/pdf',
  folder: 'application/vnd.google-apps.folder',
};

function idPart(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('BAD_ID');
  return id;
}

export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function kindOf(mimeType: string): DriveFileKind {
  return (Object.entries(mimeByKind).find(([, mime]) => mime === mimeType)?.[0] as DriveFileKind | undefined) ?? 'other';
}

function fromWire(file: WireFile): DriveFile {
  return {
    id: file.id, name: file.name, mimeType: file.mimeType, kind: kindOf(file.mimeType),
    ...(file.size !== undefined ? { size: Number(file.size) } : {}),
    ...(file.modifiedTime !== undefined ? { modifiedTime: file.modifiedTime } : {}),
  };
}

export class DriveClient implements DriveApi {
  constructor(private readonly http: GoogleTransport, private readonly now: () => number = Date.now) {}

  async search(input: { text: string; kind?: DriveFileKind | 'any'; modifiedWithinDays?: number; maxResults?: number }): Promise<DriveFile[]> {
    const clauses = ['trashed = false'];
    if (input.text.trim()) {
      const text = escapeDriveQuery(input.text.trim());
      clauses.push(`(name contains '${text}' or fullText contains '${text}')`);
    }
    if (input.kind && input.kind !== 'any' && input.kind !== 'other') {
      clauses.push(`mimeType = '${mimeByKind[input.kind]}'`);
    } else if (input.kind === 'other') {
      for (const mime of Object.values(mimeByKind)) clauses.push(`mimeType != '${mime}'`);
    }
    if (input.modifiedWithinDays !== undefined) {
      if (!Number.isInteger(input.modifiedWithinDays) || input.modifiedWithinDays < 0) throw new Error('BAD_DAYS');
      clauses.push(`modifiedTime > '${new Date(this.now() - input.modifiedWithinDays * 86_400_000).toISOString()}'`);
    }
    const url = new URL(base);
    url.searchParams.set('q', clauses.join(' and '));
    url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime)');
    url.searchParams.set('pageSize', String(Math.max(1, Math.min(25, Math.floor(input.maxResults ?? 25)))));
    const page = await (await this.http.request('GET', url)).json() as { files?: WireFile[] };
    return (page.files ?? []).map(fromWire);
  }

  async getFile(id: string): Promise<DriveFile> {
    const url = new URL(`${base}/${idPart(id)}`);
    url.searchParams.set('fields', 'id,name,mimeType,size,modifiedTime');
    return fromWire(await (await this.http.request('GET', url)).json() as WireFile);
  }

  async exportText(id: string): Promise<string> {
    const url = new URL(`${base}/${idPart(id)}/export`);
    url.searchParams.set('mimeType', 'text/plain');
    return (await this.http.request('GET', url)).text();
  }

  async download(id: string): Promise<Uint8Array> {
    const url = new URL(`${base}/${idPart(id)}`);
    url.searchParams.set('alt', 'media');
    return new Uint8Array(await (await this.http.request('GET', url)).arrayBuffer());
  }
}
