import type { SheetsApi } from './api';
import type { GoogleTransport } from './calendarClient';

function idPart(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('BAD_ID');
  return id;
}
const base = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsClient implements SheetsApi {
  constructor(private readonly http: GoogleTransport) {}

  async info(sheetId: string): Promise<{ id: string; title: string; tabs: Array<{ title: string; rows: number; columns: number }> }> {
    const url = new URL(`${base}/${idPart(sheetId)}`);
    url.searchParams.set('fields', 'spreadsheetId,properties(title),sheets(properties(title,gridProperties(rowCount,columnCount)))');
    const sheet = await (await this.http.request('GET', url)).json() as {
      spreadsheetId: string; properties?: { title?: string };
      sheets?: Array<{ properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
    };
    return {
      id: sheet.spreadsheetId, title: sheet.properties?.title ?? '',
      tabs: (sheet.sheets ?? []).map(({ properties }) => ({
        title: properties?.title ?? '', rows: properties?.gridProperties?.rowCount ?? 0,
        columns: properties?.gridProperties?.columnCount ?? 0,
      })),
    };
  }

  async getValues(sheetId: string, range: string): Promise<string[][]> {
    const url = new URL(`${base}/${idPart(sheetId)}/values/${encodeURIComponent(range)}`);
    const data = await (await this.http.request('GET', url)).json() as { values?: unknown[][] };
    return (data.values ?? []).map((row) => row.map((cell) => String(cell)));
  }
}
