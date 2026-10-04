import type { AgentDefinition, ToolDefinition } from '../../../shared/tools';
import { beaverSystemPrompt } from './prompt';
import { BEAVER_RISKS, BEAVER_SCHEMAS, type BeaverToolName } from './schemas';

export { beaverSystemPrompt, beaverStatus } from './prompt';
export { BEAVER_SCHEMAS, BEAVER_TOOL_NAMES, BEAVER_RISKS, type BeaverToolName } from './schemas';

/** Tools are supplied by lanes T/O. Preserve their gate previews and inspection hooks. */
export type BeaverBindings = Partial<Record<BeaverToolName, Pick<ToolDefinition<unknown, unknown>, 'execute' | 'preview' | 'inspect' | 'riskFor'>>>;

const descriptions: Partial<Record<BeaverToolName, string>> = {
  fs_move: 'Move one file to a folder, after Warden approval.',
  fs_rename: 'Rename one file, after Warden approval.',
  fs_mkdir: 'Create a folder, after Warden approval.',
};

/** Unbound tools fail closed; a definition alone never performs filesystem operations. */
export function createBeaverAgent(bindings: BeaverBindings = {}): AgentDefinition {
  return {
    id: 'beaver',
    systemPrompt: beaverSystemPrompt(),
    maxToolRounds: 8,
    tools: BEAVER_SCHEMAS.map((schema) => {
      const binding = bindings[schema.name];
      return {
        name: schema.name,
        description: schema.description ?? descriptions[schema.name]!,
        parameters: structuredClone(schema.parameters),
        risk: BEAVER_RISKS[schema.name],
        ...binding,
        execute: binding?.execute ?? (async () => ({ error: 'TOOL_NOT_CONFIGURED', tool: schema.name })),
        preview: binding?.preview ?? (BEAVER_RISKS[schema.name] === 'read' ? undefined : () => 'Archie tool not configured'),
      };
    }),
  };
}

export const beaverAgent: AgentDefinition = createBeaverAgent();

