export const PLAN_AGENTS = ['workspace', 'beaver', 'eagle'] as const;
export type PlanAgent = typeof PLAN_AGENTS[number];
export interface PlanStep { n: number; agent: PlanAgent; task: string }
export interface SwarmPlan { goal: string; steps: PlanStep[] }

/** Validate both tool arguments and the JSON passed back to Chip. */
export function parsePlan(value: unknown): PlanStep[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const steps = (value as { steps?: unknown }).steps;
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) return null;
  const parsed: PlanStep[] = [];
  for (const [index, step] of steps.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    const { n, agent, task } = step as Record<string, unknown>;
    if (n !== index + 1 || !PLAN_AGENTS.includes(agent as PlanAgent) ||
        typeof task !== 'string' || !task.trim()) return null;
    parsed.push({ n, agent: agent as PlanAgent, task: task.trim() });
  }
  return parsed;
}

export function parsePlanSummary(summary: string): PlanStep[] | null {
  const block = /```(?:json)?\s*([\s\S]*?)```/i.exec(summary);
  const source = block?.[1] ?? summary.trim();
  try { return parsePlan(JSON.parse(source)); }
  catch { return null; }
}
