import type { AgentDefinition } from '../../../shared/tools';
import { antsSystemPrompt } from './prompt';
import { createAntsTools, type SwarmPlanStore } from './tools';

export { antsSystemPrompt } from './prompt';
export { createAntsTools, createSwarmPlanStore, type SwarmPlanStore } from './tools';
export { parsePlan, parsePlanSummary, type PlanStep, type SwarmPlan } from './plan';

export function createAntsAgent(store: SwarmPlanStore): AgentDefinition {
  return { id: 'ants', systemPrompt: antsSystemPrompt(), maxToolRounds: 4, tools: createAntsTools(store) };
}
