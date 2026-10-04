import type { AgentDefinition, ToolDefinition } from '../../../shared/tools';
import { PIXEL_SYSTEM_PROMPT } from './prompt';
import { PIXEL_TOOL_SCHEMAS } from './schemas';

const WRITES = new Set(['cal_create_event', 'cal_update_event', 'docs_append']);
const PREVIEWS = new Set([...WRITES, 'gmail_create_draft', 'gmail_reply_draft', 'gmail_update_draft', 'docs_create']);
const INSPECTS = new Set(['gmail_create_draft', 'gmail_reply_draft', 'cal_create_event']);

/** T1 and T2 provide executors; this factory keeps the public schema contract fixed. */
export function createPixelAgent(executors: readonly ToolDefinition[]): AgentDefinition {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of executors) {
    if (byName.has(tool.name)) throw new Error(`Duplicate Pixel executor: ${tool.name}`);
    byName.set(tool.name, tool);
  }
  const expected = new Set(PIXEL_TOOL_SCHEMAS.map((schema) => schema.name));
  for (const name of byName.keys()) {
    if (!expected.has(name)) throw new Error(`Unknown Pixel executor: ${name}`);
  }
  const tools = PIXEL_TOOL_SCHEMAS.map((schema) => {
    const executor = byName.get(schema.name);
    if (!executor) throw new Error(`Missing Pixel executor: ${schema.name}`);
    if (WRITES.has(schema.name) && executor.risk !== 'write') throw new Error(`Pixel write risk required: ${schema.name}`);
    if (PREVIEWS.has(schema.name) && !executor.preview) throw new Error(`Pixel preview required: ${schema.name}`);
    if (INSPECTS.has(schema.name) && !executor.inspect) {
      throw new Error(`Pixel tool requires inspection: ${schema.name}`);
    }
    return { ...executor, ...schema };
  });
  return { id: 'workspace', systemPrompt: PIXEL_SYSTEM_PROMPT, tools, maxToolRounds: 8 };
}
