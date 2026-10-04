import { AGENTS } from '../../shared/config';
import type { AgentResult, Clock, SpecialistId, SpecialistRunContext, SpecialistRunner } from '../runtime/types';

export type FakeBehavior = (task: string, ctx: SpecialistRunContext) => AgentResult | Promise<AgentResult>;

const DEFAULT_DELAY_MS = 3000;

const SAY: Record<SpecialistId, string> = {
  workspace: 'Your drafts are ready!',
  beaver: 'Tidied up and ready!',
  eagle: 'Found three good options!',
  ants: 'Your day is mapped out!',
  butterfly: 'Posts are drafted!',
  nightingale: 'Something soothing is queued!',
};

/** A canned, in-character result. `overrides` replaces any field. */
export function fakeResult(agent: SpecialistId, overrides: Partial<AgentResult> = {}): AgentResult {
  const name = AGENTS[agent].displayName;
  return { ok: true, say: SAY[agent], bubble: `${name} ✓`, summary: `${name} finished.`, artifacts: [], ...overrides };
}

/** Fake animals: wait on the Clock, then return a canned result (or a scripted behavior's). */
export class FakeSpecialists implements SpecialistRunner {
  readonly runs: { agentId: SpecialistId; task: string; ctx: SpecialistRunContext; startedAt: number }[] = [];
  private readonly clock: Clock;
  private readonly delayMs: number | Partial<Record<SpecialistId, number>>;
  private readonly behaviors: Partial<Record<SpecialistId, FakeBehavior>>;

  constructor(opts: {
    clock: Clock;
    delayMs?: number | Partial<Record<SpecialistId, number>>;
    behaviors?: Partial<Record<SpecialistId, FakeBehavior>>;
  }) {
    this.clock = opts.clock;
    this.delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
    this.behaviors = { ...opts.behaviors };
  }

  setBehavior(agent: SpecialistId, b: FakeBehavior): void {
    this.behaviors[agent] = b;
  }

  async run(agentId: SpecialistId, task: string, ctx: SpecialistRunContext): Promise<AgentResult> {
    this.runs.push({ agentId, task, ctx, startedAt: this.clock.now() });
    await this.wait(this.delayFor(agentId), ctx.signal);
    const behavior = this.behaviors[agentId];
    if (behavior) return behavior(task, ctx);
    return fakeResult(agentId, { summary: `${AGENTS[agentId].displayName} finished: ${task.slice(0, 80)}` });
  }

  private delayFor(agent: SpecialistId): number {
    if (typeof this.delayMs === 'number') return this.delayMs;
    return this.delayMs[agent] ?? DEFAULT_DELAY_MS;
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = (): void => {
        this.clock.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = this.clock.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
