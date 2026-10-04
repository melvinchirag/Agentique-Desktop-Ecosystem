import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Risk, ToolDefinition } from '../../src/shared/tools';
import { createPixelAgent } from '../../src/main/agents/workspace';
import { PIXEL_SYSTEM_PROMPT } from '../../src/main/agents/workspace/prompt';
import { PIXEL_TOOL_SCHEMAS } from '../../src/main/agents/workspace/schemas';
import { PIXEL_STATUS } from '../../src/main/agents/workspace/status';
import { STYLE_LEARNING_PROMPT, styleLearningInput } from '../../src/main/agents/workspace/style/prompt';

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expectedNames = [
  'gmail_search', 'gmail_read_thread', 'gmail_digest', 'gmail_list_drafts', 'gmail_ask_attachment',
  'gmail_create_draft', 'gmail_reply_draft', 'gmail_update_draft', 'cal_list_events',
  'cal_create_event', 'cal_update_event', 'drive_search', 'drive_read_text', 'drive_ask_file',
  'docs_create', 'docs_append', 'sheets_read', 'style_get',
];
const writeNames = new Set(['cal_create_event', 'cal_update_event', 'docs_append']);
const draftNames = new Set(['gmail_create_draft', 'gmail_reply_draft', 'gmail_update_draft', 'docs_create']);
const attachmentNames = new Set(['gmail_create_draft', 'gmail_reply_draft']);

function validSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const node = schema as Record<string, unknown>;
  if (!['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(String(node.type))) return false;
  if (node.type === 'object') {
    if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) return false;
    const properties = node.properties as Record<string, unknown>;
    if (!Object.values(properties).every(validSchema)) return false;
    if (node.required !== undefined && (!Array.isArray(node.required) ||
      !node.required.every((name) => typeof name === 'string' && name in properties))) return false;
  }
  if (node.type === 'array' && !validSchema(node.items)) return false;
  if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) return false;
  for (const bound of ['minimum', 'maximum', 'minItems', 'maxItems', 'maxLength']) {
    if (node[bound] !== undefined && (typeof node[bound] !== 'number' || !Number.isFinite(node[bound]))) return false;
  }
  return true;
}

describe('Pixel prompt and schemas', () => {
  it('snapshots the complete prompt, style prompt and exact §3.2 schema output', () => {
    expect(digest(PIXEL_SYSTEM_PROMPT)).toMatchInlineSnapshot(`"03dc1a5b9463c699ecadb40f88507b29ae2e0374ba2e5be2467ceffc8e4495ea"`);
    expect(digest(STYLE_LEARNING_PROMPT)).toMatchInlineSnapshot(`"78b484af895f42509418a056f987b2c21ef09c5fc60fdf7f1b8ea3343dd4b89a"`);
    expect(digest(PIXEL_TOOL_SCHEMAS)).toMatchInlineSnapshot(`"58b506911a624358cfd9e17e23637b48eabe288643ad6e9d3ee415b087c37010"`);
  });

  it('keeps the 18 valid, unique schemas clear of W1 and file-path scan names', () => {
    expect(PIXEL_TOOL_SCHEMAS.map((schema) => schema.name)).toEqual(expectedNames);
    expect(new Set(expectedNames).size).toBe(18);
    for (const schema of PIXEL_TOOL_SCHEMAS) {
      expect(validSchema(schema.parameters), schema.name).toBe(true);
      expect(schema.name).not.toMatch(/^fs_/);
      expect(schema.name).not.toMatch(/send|forward|post|publish|share|purchase|pay|transfer|invite/);
      const properties = (schema.parameters as { properties: Record<string, unknown> }).properties;
      expect(Object.keys(properties)).not.toContain('to');
      expect(Object.keys(properties)).not.toContain('path');
      expect(Object.keys(properties)).not.toContain('file');
    }
  });

  it('registers later executors with frozen schemas and preserves safety metadata', () => {
    const executors: ToolDefinition[] = PIXEL_TOOL_SCHEMAS.map((schema) => {
      const risk: Risk = writeNames.has(schema.name) ? 'write' : draftNames.has(schema.name) ? 'draft' : 'read';
      return {
        ...schema, risk,
        ...(writeNames.has(schema.name) || draftNames.has(schema.name) ? { preview: () => 'Review change' } : {}),
        ...(attachmentNames.has(schema.name) || schema.name === 'cal_create_event'
          ? { inspect: () => ({ attachments: [], hasAttendees: false }) } : {}),
        execute: async () => ({ ok: true }),
      };
    });
    const agent = createPixelAgent(executors);
    expect(agent.id).toBe('workspace');
    expect(agent.maxToolRounds).toBe(8);
    expect(agent.tools.map((tool) => tool.name)).toEqual(expectedNames);
    for (const tool of agent.tools) {
      expect(tool.parameters).toEqual(PIXEL_TOOL_SCHEMAS.find((schema) => schema.name === tool.name)?.parameters);
      if (tool.risk === 'write' || tool.risk === 'draft') expect(tool.preview).toBeTypeOf('function');
      if (attachmentNames.has(tool.name) || tool.name === 'cal_create_event') expect(tool.inspect).toBeTypeOf('function');
    }
    expect(() => createPixelAgent(executors.slice(1))).toThrow('Missing Pixel executor');
    expect(() => createPixelAgent([...executors, executors[0]])).toThrow('Duplicate Pixel executor');
    expect(() => createPixelAgent(executors.map((tool) => tool.name === 'docs_append' ? { ...tool, preview: undefined } : tool)))
      .toThrow('Pixel preview required');
  });

  it('includes drafting, trust, approval and return rules', () => {
    expect(PIXEL_SYSTEM_PROMPT).toContain('call style_get FIRST');
    expect(PIXEL_SYSTEM_PROMPT).toContain("It's in your Drafts. You hit send.");
    expect(PIXEL_SYSTEM_PROMPT).toContain('FINAL ANSWER FORMAT (always):');
    expect(PIXEL_SYSTEM_PROMPT).toContain('RULES\n');
    expect(PIXEL_SYSTEM_PROMPT).toContain('DENIED_BY_WOLF or USER_DECLINED');
    expect(STYLE_LEARNING_PROMPT).toContain('Return ONLY a JSON object');
    expect(styleLearningInput({ avgWords: 42 }, ['Hey <name>, thanks!'])).toContain('SAMPLES\n["Hey <name>, thanks!"]');
  });

  it('keeps status events to actions and safe counts', () => {
    expect(PIXEL_STATUS.sortingLetters(12)).toBe('Sorting 12 new letters…');
    expect(PIXEL_STATUS.readingThread(3)).toBe('Reading a thread (3 messages)…');
    expect(PIXEL_STATUS.learningStyle(40, 100)).toBe('Learning how you write… 40/100');
    expect(PIXEL_STATUS.sortingLetters(Number.NaN)).toBe('Sorting 0 new letters…');
  });
});
