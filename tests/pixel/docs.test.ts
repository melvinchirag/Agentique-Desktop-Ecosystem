import { describe, expect, it, vi } from 'vitest';
import type { GoogleApi } from '../../src/main/connectors/google/api';
import { createDocsTools, markdownRequests } from '../../src/main/agents/workspace/docsTools';
import { createSheetsTools, validateA1Range } from '../../src/main/agents/workspace/sheetsTools';
import { createStyleTool } from '../../src/main/agents/workspace/styleTool';
import type { InjectionScreen } from '../../src/main/runtime/types';
import type { ToolContext } from '../../src/shared/tools';

const calls: unknown[] = [];
const api = {
  docs: { create: vi.fn(async (title: string) => ({ id: 'new-doc', title })), batchUpdate: vi.fn(async (...args: unknown[]) => { calls.push(args); }), getEndIndex: vi.fn(async () => 44) },
  sheets: { info: vi.fn(async () => ({ id: 's1', title: 'Budget', tabs: [{ title: 'Fall', rows: 20, columns: 4 }] })), getValues: vi.fn(async () => [['CANARY-CELL', '42']]) },
} as unknown as GoogleApi;
const screen: InjectionScreen = { screen: async (text, source) => ({ flagged: text.includes('CANARY'), score: 0, reasons: [], wrapped: `<untrusted source="${source.name}" flagged="${text.includes('CANARY')}">${text}</untrusted>` }) };
const emit = vi.fn();
const context = { agentId: 'workspace', taskId: 't', jobId: 'j', sessionId: 's', threadId: 'thread', signal: new AbortController().signal, emit } as unknown as ToolContext;

describe('Pixel Docs tools', () => {
  it('builds UTF-16 style ranges and rejects non-http(s) links', () => {
    const requests = markdownRequests('# 😀 你好\n- **bold** [docs](https://example.com)');
    const insert = requests[0] as any;
    expect(insert.insertText.text).toContain('😀 你好');
    expect(requests.some((request: any) => request.updateParagraphStyle?.paragraphStyle.namedStyleType === 'HEADING_1')).toBe(true);
    const bold = requests.find((request: any) => request.updateTextStyle?.textStyle.bold) as any;
    expect(insert.insertText.text.slice(bold.updateTextStyle.range.startIndex - 1, bold.updateTextStyle.range.endIndex - 1)).toBe('bold');
    expect(() => markdownRequests('[bad](javascript:alert(1))')).toThrow('UNSUPPORTED_LINK');
  });

  it('creates a private doc artifact without writing body text into events and requires ownership for append', async () => {
    const owned = new Set<string>();
    const services = { google: () => api, screen, registerDoc: async ({ id }: { id: string }) => { owned.add(id); }, isOwnedDoc: async (id: string) => owned.has(id) };
    const [create, append] = createDocsTools(services);
    expect(create.risk).toBe('draft');
    const result = await create.execute({ title: 'Report', body_markdown: 'CANARY-DOC body' }, context) as any;
    expect(result.doc_id).toBe('new-doc');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'google_doc', openUrl: 'https://docs.google.com/document/d/new-doc/edit', data: { title: 'Report' } }));
    expect(JSON.stringify(emit.mock.calls)).not.toContain('CANARY-DOC');
    expect(append.risk).toBe('write');
    expect(append.preview?.({ doc_id: 'new-doc', body_markdown: 'first\nsecond' })).toContain('2 paragraphs');
    await expect(append.execute({ doc_id: 'foreign', body_markdown: 'text' }, context)).resolves.toMatchObject({ error: 'NOT_ADE_DOC' });
    await append.execute({ doc_id: 'new-doc', body_markdown: 'appended' }, context);
    expect(api.docs.getEndIndex).toHaveBeenCalledWith('new-doc');
    expect((calls.at(-1) as any[])[1][0].insertText.location.index).toBe(43);
  });
});

describe('Pixel Sheets and style tools', () => {
  it('validates A1 notation and caps returned cell data while screening values', async () => {
    expect(validateA1Range("'Fall 2026'!A1:D20")).toBe(true);
    expect(validateA1Range('A1:ZZ100')).toBe(false);
    expect(validateA1Range('A0:B2')).toBe(false);
    expect(validateA1Range('A1:B2; DROP TABLE')).toBe(false);
    const [read] = createSheetsTools({ google: () => api, screen });
    expect((await read.execute({ spreadsheet_id: 's1', range: 'A1:B2' }, context) as any).cells).toContain('CANARY-CELL');
    expect((await read.execute({ spreadsheet_id: 's1', range: 'A1:ZZ100' }, context) as any).error).toBe('BAD_RANGE');
    expect((await read.execute({ spreadsheet_id: 's1' }, context) as any).range).toBe("'Fall'!A1:D10");
  });

  it('returns profile or NO_STYLE and reports disconnected first', async () => {
    const [style] = createStyleTool({ google: () => api, screen, getStyle: async () => ({ formality: 2, examples: ['short'] }) });
    await expect(style.execute({}, context)).resolves.toEqual({ profile: { formality: 2, examples: ['short'] } });
    const [empty] = createStyleTool({ google: () => api, screen, getStyle: async () => null });
    await expect(empty.execute({}, context)).resolves.toEqual({ error: 'NO_STYLE' });
    const [offline] = createStyleTool({ google: () => undefined, screen });
    await expect(offline.execute({}, context)).resolves.toEqual({ error: 'NOT_CONNECTED' });
  });
});
