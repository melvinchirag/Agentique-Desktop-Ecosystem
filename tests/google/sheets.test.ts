import { expect, it } from 'vitest';
import { SheetsClient } from '../../src/main/connectors/google/sheetsClient';
import type { GoogleTransport } from '../../src/main/connectors/google/calendarClient';

it('reads spreadsheet info and values from the Sheets API', async () => {
  const urls: URL[] = [];
  const replies = [
    Response.json({ spreadsheetId: 'sheet_1', properties: { title: 'Budget' }, sheets: [{ properties: { title: 'Fall', gridProperties: { rowCount: 100, columnCount: 8 } } }] }),
    Response.json({ values: [['Name', 'Cost'], ['Tickets', 15], ['Empty']] }),
  ];
  const http: GoogleTransport = { async request(_method, input) { urls.push(new URL(input)); return replies.shift() ?? Response.json({}); } };
  const client = new SheetsClient(http);
  expect(await client.info('sheet_1')).toEqual({ id: 'sheet_1', title: 'Budget', tabs: [{ title: 'Fall', rows: 100, columns: 8 }] });
  expect(await client.getValues('sheet_1', "Fall!A1:B3")).toEqual([['Name', 'Cost'], ['Tickets', '15'], ['Empty']]);
  expect(decodeURIComponent(urls[1]!.pathname)).toBe('/v4/spreadsheets/sheet_1/values/Fall!A1:B3');
});
