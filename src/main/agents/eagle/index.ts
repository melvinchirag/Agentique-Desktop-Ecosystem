import type { AgentDefinition } from '../../../shared/tools';
import { eagleSystemPrompt } from './prompt';
import { createEagleTools, type EagleToolDeps } from './tools';

export { eagleSystemPrompt } from './prompt';
export { createEagleTools, safeWebUrl, briefPath, type EagleToolDeps } from './tools';

export function createEagleAgent(deps: EagleToolDeps): AgentDefinition {
  return { id: 'eagle', systemPrompt: eagleSystemPrompt(), maxToolRounds: 6, webSearch: true, tools: createEagleTools(deps) };
}
