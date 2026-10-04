import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { beaverAgent, createBeaverAgent, beaverStatus, BEAVER_RISKS, BEAVER_SCHEMAS, BEAVER_TOOL_NAMES } from '../src/main/agents/beaver';
import type { ToolContext } from '../src/shared/tools';

const spec = readFileSync(new URL('../docs/agents/02-archie-files.md', import.meta.url), 'utf8');
const fence = '`'.repeat(3);
function section(n: number): string {
  return spec.split(`## ${n}. `)[1]!.split('\n## ')[0]!;
}

// Validate the JSON Schema vocabulary used by the approved schemas without adding a dependency.
function validateSchema(value: unknown): void {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  const node = value as Record<string, unknown>;
  expect(['object', 'array', 'string', 'integer', 'boolean', 'number']).toContain(node.type);
  if (node.type === 'object') {
    const properties = node.properties as Record<string, unknown>;
    expect(properties).toBeTypeOf('object');
    for (const child of Object.values(properties)) validateSchema(child);
    if (node.required !== undefined) {
      expect(Array.isArray(node.required)).toBe(true);
      for (const key of node.required as string[]) expect(Object.hasOwn(properties, key)).toBe(true);
    }
  }
  if (node.type === 'array') validateSchema(node.items);
  for (const key of ['minimum', 'maximum', 'maxItems']) {
    if (node[key] !== undefined) expect(node[key]).toBeTypeOf('number');
  }
  if (node.minimum !== undefined && node.maximum !== undefined) expect(node.minimum as number).toBeLessThanOrEqual(node.maximum as number);
  if (node.enum !== undefined) {
    expect(Array.isArray(node.enum)).toBe(true);
    expect((node.enum as unknown[]).length).toBeGreaterThan(0);
  }
}

describe('Archie prompt and definition', () => {
  it('preserves the exact section 8 prompt and shared rules, using the current biome terminology', () => {
    const expectedPrompt = section(8).split(fence)[1]!.trim();
    const sharedDoc = readFileSync(new URL('../docs/AGENTS.md', import.meta.url), 'utf8');
    const expectedRules = sharedDoc.split('Shared rules that go')[1]!.split(fence)[1]!.trim().replace('ADE forest', 'ADE biome');
    expect(beaverAgent.systemPrompt).toBe(`${expectedPrompt}\n\n${expectedRules}`);
    expect(beaverAgent).toMatchObject({ id: 'beaver', maxToolRounds: 8 });
    expect(beaverAgent.webSearch).toBeUndefined();
  });

  it('matches all 16 approved schemas verbatim and validates their structure', () => {
    const expected = section(4).split(fence + 'json').slice(1).flatMap((block) =>
      block.split(fence)[0]!.split(/\n(?=\{)/).map((item) => item.trim()).filter(Boolean).map((item) => JSON.parse(item)));
    expect(BEAVER_SCHEMAS).toEqual(expected);
    expect(BEAVER_SCHEMAS).toHaveLength(16);
    expect(new Set(BEAVER_TOOL_NAMES).size).toBe(16);
    expect(beaverAgent.tools.map((tool) => tool.name)).toEqual(BEAVER_TOOL_NAMES);
    for (const tool of beaverAgent.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(tool.parameters))).toEqual(tool.parameters);
      validateSchema(tool.parameters);
    }
  });

  it('keeps planning read-only and every mutating tool at the specified risk', () => {
    expect(BEAVER_RISKS.fs_plan_organize).toBe('read');
    expect(BEAVER_RISKS.fs_propose_plan).toBe('read');
    expect(BEAVER_RISKS.fs_trash).toBe('destructive');
    for (const name of ['fs_apply_plan', 'fs_move', 'fs_rename', 'fs_mkdir', 'fs_undo'] as const) expect(BEAVER_RISKS[name]).toBe('write');
    expect(beaverAgent.tools.some((tool) => tool.risk === 'external')).toBe(false);
    for (const tool of beaverAgent.tools.filter((item) => item.risk !== 'read')) expect(tool.preview).toBeTypeOf('function');
  });

  it('fails closed for every unbound executor, without reading any real file', async () => {
    const ctx: ToolContext = { agentId: 'beaver', taskId: 'test-task', jobId: 'test-job', sessionId: 'test-session', threadId: 'test-thread', emit: vi.fn(), signal: new AbortController().signal };
    for (const tool of beaverAgent.tools) {
      await expect(tool.execute({}, ctx)).resolves.toEqual({ error: 'TOOL_NOT_CONFIGURED', tool: tool.name });
    }
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it('preserves injected tool hooks and isolates parameter objects between definitions', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const preview = vi.fn(() => 'Move approved fixture file');
    const inspect = vi.fn(() => ({ count: 1 }));
    const riskFor = vi.fn(() => 'write' as const);
    const agent = createBeaverAgent({ fs_move: { execute, preview, inspect, riskFor } });
    const tool = agent.tools.find((item) => item.name === 'fs_move')!;
    expect(tool).toMatchObject({ execute, preview, inspect, riskFor });
    tool.parameters.required = [];
    expect(createBeaverAgent().tools.find((item) => item.name === 'fs_move')!.parameters.required).toEqual(['from', 'to_folder']);
  });

  it('formats all section 10 status details', () => {
    expect([
      beaverStatus.sniffing('Downloads'), beaverStatus.plan(37, 5), beaverStatus.applying(12, 37),
      beaverStatus.trashing(3), beaverStatus.sweeping(),
    ]).toEqual([
      'Sniffing through Downloads…', 'Plan: 37 files → 5 folders', 'Building the dam… 12/37',
      'Hauling 3 files to ADE Trash…', 'Emptying old ADE Trash',
    ]);
  });
});
