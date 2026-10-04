import type { ToolDefinition } from '../../../shared/tools';
import { parsePlan, type SwarmPlan } from './plan';

export interface SwarmPlanStore {
  save(plan: SwarmPlan): Promise<void>;
  latest(): SwarmPlan | undefined;
}

/** Local store; an optional Tiger writer can append plan_items when available. */
export function createSwarmPlanStore(appendItems?: (plan: SwarmPlan) => Promise<void>): SwarmPlanStore {
  let current: SwarmPlan | undefined;
  return {
    async save(plan) {
      current = structuredClone(plan);
      await appendItems?.(structuredClone(plan));
    },
    latest: () => current && structuredClone(current),
  };
}

export function createAntsTools(store: SwarmPlanStore): ToolDefinition[] {
  return [{
    name: 'plan_save', description: 'Save a numbered plan for Chip to delegate. This does not execute any step.',
    parameters: { type: 'object', properties: {
      goal: { type: 'string' },
      steps: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', properties: {
        n: { type: 'integer' }, agent: { type: 'string', enum: ['workspace', 'beaver', 'eagle'] }, task: { type: 'string' },
      }, required: ['n', 'agent', 'task'], additionalProperties: false } },
    }, required: ['goal', 'steps'], additionalProperties: false },
    risk: 'draft',
    async execute(input: { goal?: unknown; steps?: unknown }, ctx) {
      const steps = parsePlan({ steps: input.steps });
      if (typeof input.goal !== 'string' || !input.goal.trim() || !steps) return { error: 'INVALID_PLAN' };
      const plan = { goal: input.goal.trim(), steps };
      await store.save(plan);
      ctx.emit({ type: 'artifact', agentId: 'ants', taskId: ctx.taskId, kind: 'day_plan',
        title: `Plan: ${plan.goal}`, data: plan });
      return { saved: true, steps };
    },
  }];
}
