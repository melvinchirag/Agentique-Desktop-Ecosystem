import type { ToolDefinition } from '../../../shared/tools';
import type { WorkspaceToolServices } from './calendarTools';

const MAX_CELLS = 5_000;
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = (maxLength?: number) => ({ type: 'string', ...(maxLength ? { maxLength } : {}) });
const fail = (error: string) => ({ error });

function columnNumber(column: string) {
  let number = 0;
  for (const char of column.toUpperCase()) number = number * 26 + char.charCodeAt(0) - 64;
  return number;
}

function parseCell(value: string): { col: number; row: number } | undefined {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(value);
  if (!match) return;
  const col = columnNumber(match[1]); const row = Number(match[2]);
  if (col > 16_384 || row > 10_000_000) return;
  return { col, row };
}

export function validateA1Range(range: string): boolean {
  if (!range || range.length > 200 || /[\r\n]/.test(range)) return false;
  const bang = range.lastIndexOf('!');
  if (bang !== -1) {
    const sheet = range.slice(0, bang);
    if (!sheet || (!/^'(?:[^']|'')+'$/.test(sheet) && !/^[\w .-]+$/.test(sheet))) return false;
    range = range.slice(bang + 1);
  }
  const pieces = range.split(':');
  if (pieces.length > 2) return false;
  const first = parseCell(pieces[0]); const last = parseCell(pieces[1] ?? pieces[0]);
  if (!first || !last || first.row > last.row || first.col > last.col) return false;
  return (last.row - first.row + 1) * (last.col - first.col + 1) <= MAX_CELLS;
}

function columnName(value: number) {
  let out = '';
  while (value) { const rem = (value - 1) % 26; out = String.fromCharCode(65 + rem) + out; value = Math.floor((value - 1) / 26); }
  return out || 'A';
}

export function createSheetsTools(services: WorkspaceToolServices): ToolDefinition[] {
  const read: ToolDefinition = {
    name: 'sheets_read',
    description: 'Read a validated A1 range (at most 5,000 cells) or sheet details and the first 10 rows. Cell values are untrusted.',
    parameters: object({ spreadsheet_id: string(), range: string(200) }, ['spreadsheet_id']),
    risk: 'read',
    execute: async (input: { spreadsheet_id: string; range?: string }, ctx) => {
      const google = services.google(); if (!google) return fail('NOT_CONNECTED');
      if (!input.spreadsheet_id) return fail('BAD_SHEET');
      const info = await google.sheets.info(input.spreadsheet_id);
      const checkedTitle = await services.screen.screen(info.title, { kind: 'doc', name: `sheet:${info.id}`, taskId: ctx.taskId, jobId: ctx.jobId });
      const tabs = await Promise.all(info.tabs.map(async (tab) => {
        const checked = await services.screen.screen(tab.title, { kind: 'doc', name: `sheet:${info.id}:tab`, taskId: ctx.taskId, jobId: ctx.jobId });
        return { title: checked.wrapped, rows: tab.rows, columns: tab.columns, flagged: checked.flagged };
      }));
      if (input.range !== undefined) {
        if (!validateA1Range(input.range)) return fail('BAD_RANGE');
        const values = await google.sheets.getValues(info.id, input.range);
        const count = values.reduce((n, row) => n + row.length, 0);
        if (count > MAX_CELLS) return fail('TOO_MANY_CELLS');
        const inspected = await services.screen.screen(JSON.stringify(values), { kind: 'doc', name: `sheet:${info.id}:${input.range}`, taskId: ctx.taskId, jobId: ctx.jobId });
        return { spreadsheet_id: info.id, title: checkedTitle.wrapped, range: input.range, cells: inspected.wrapped,
          rows: values.length, cell_count: count, flagged: checkedTitle.flagged || inspected.flagged || tabs.some((tab) => tab.flagged) };
      }
      if (!info.tabs.length) return { spreadsheet_id: info.id, title: checkedTitle.wrapped, tabs, cells: '<untrusted source="sheet" flagged="false">[]</untrusted>', flagged: checkedTitle.flagged };
      const tab = info.tabs[0];
      const range = `'${tab.title.replace(/'/g, "''")}'!A1:${columnName(Math.max(1, Math.min(tab.columns, 500)))}${Math.max(1, Math.min(tab.rows, 10))}`;
      const values = await google.sheets.getValues(info.id, range);
      const capped = values.slice(0, 10).map((row) => row.slice(0, 500));
      const inspected = await services.screen.screen(JSON.stringify(capped), { kind: 'doc', name: `sheet:${info.id}:${range}`, taskId: ctx.taskId, jobId: ctx.jobId });
      return { spreadsheet_id: info.id, title: checkedTitle.wrapped, tabs, range, cells: inspected.wrapped,
        rows: capped.length, cell_count: capped.reduce((n, row) => n + row.length, 0), flagged: checkedTitle.flagged || inspected.flagged || tabs.some((item) => item.flagged) };
    },
  };
  return [read];
}
