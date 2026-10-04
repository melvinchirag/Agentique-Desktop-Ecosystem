import { randomUUID } from 'node:crypto';
import { redact, type Db } from './tiger';

export type PlanStatus = 'planned' | 'done' | 'moved' | 'skipped';
export interface PlanStepInput { title: string; startAt?: Date; endAt?: Date }
export interface PlanStep {
  id: string; planId: string; goal: string; stepNo: number; title: string; status: PlanStatus;
  planDate: string;                              // YYYY-MM-DD, the user's local day
  startAt?: Date; endAt?: Date;
}
/** Swarm's plans. Declared here (not in the shared contracts) per 06-swarm-QUICK-SHAFEEN.md W2. */
export interface PlanStore {
  /** Saves one numbered plan for today and returns its steps. */
  savePlan(goal: string, steps: (string | PlanStepInput)[]): Promise<PlanStep[]>;
  markStep(id: string, status: PlanStatus): Promise<void>;
  /** Every step planned for today, in plan order. */
  today(): Promise<PlanStep[]>;
  /** "3 of 4 done" for Chip's evening wrap-up. Steps moved to another day are not counted. */
  completionToday(): Promise<{ done: number; total: number; text: string }>;
}

const COLUMNS = `id, plan_id, goal, step_no, title, status, to_char(plan_date, 'YYYY-MM-DD') AS plan_date, start_at, end_at`;
const STATUSES: PlanStatus[] = ['planned', 'done', 'moved', 'skipped'];

/** The user's local calendar day for a timestamp, as YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const fromRow = (r: Record<string, any>): PlanStep => ({
  id: r.id, planId: r.plan_id, goal: r.goal ?? '', stepNo: r.step_no ?? 0, title: r.title,
  status: STATUSES.includes(r.status) ? r.status : 'planned', planDate: r.plan_date,
  ...(r.start_at ? { startAt: new Date(r.start_at) } : {}), ...(r.end_at ? { endAt: new Date(r.end_at) } : {}),
});

/**
 * Plans in Tiger's plan_items table, with an in-memory copy so Swarm keeps working while Tiger is offline:
 * writes go to both, reads fall back to the copy. Never throws.
 */
export class TigerPlanStore implements PlanStore {
  private readonly local: PlanStep[] = [];

  constructor(private readonly db: Db, private readonly now: () => number = Date.now,
              private readonly log: (m: string) => void = (m) => console.warn(`[tiger] ${m}`)) {}

  async savePlan(goal: string, steps: (string | PlanStepInput)[]): Promise<PlanStep[]> {
    const planId = randomUUID();
    const planDate = localDay(this.now());
    const saved: PlanStep[] = steps.map((raw, i) => {
      const step = typeof raw === 'string' ? { title: raw } : raw;
      return { id: randomUUID(), planId, goal, stepNo: i + 1, title: step.title, status: 'planned' as const, planDate,
               ...(step.startAt ? { startAt: step.startAt } : {}), ...(step.endAt ? { endAt: step.endAt } : {}) };
    });
    this.local.push(...saved.map((s) => ({ ...s })));
    for (const s of saved) {
      await this.run('savePlan',
        `INSERT INTO plan_items (id, plan_id, goal, step_no, plan_date, title, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, 'planned') ON CONFLICT (id) DO NOTHING`,
        [s.id, planId, goal, s.stepNo, planDate, s.title, s.startAt ?? null, s.endAt ?? null]);
    }
    return saved;
  }

  async markStep(id: string, status: PlanStatus): Promise<void> {
    if (!STATUSES.includes(status)) return;
    const mine = this.local.find((s) => s.id === id);
    if (mine) mine.status = status;
    await this.run('markStep', 'UPDATE plan_items SET status = $2 WHERE id = $1', [id, status]);
  }

  async today(): Promise<PlanStep[]> {
    const day = localDay(this.now());
    const rows = await this.run('today', `SELECT ${COLUMNS} FROM plan_items WHERE plan_date = $1::date ORDER BY created_at, step_no`, [day]);
    if (rows) return rows.map(fromRow);
    return this.local.filter((s) => s.planDate === day).map((s) => ({ ...s }));
  }

  async completionToday(): Promise<{ done: number; total: number; text: string }> {
    const steps = (await this.today()).filter((s) => s.status !== 'moved');
    const done = steps.filter((s) => s.status === 'done').length;
    return { done, total: steps.length, text: steps.length ? `${done} of ${steps.length} done` : 'No plan today' };
  }

  /** Returns the rows, or null when Tiger failed (callers then use the in-memory copy). */
  private async run(what: string, sql: string, params: unknown[]): Promise<Record<string, any>[] | null> {
    try { return (await this.db.query(sql, params)).rows; }
    catch (err) { this.log(`plan ${what} failed: ${redact((err as Error).message)}`); return null; }
  }
}
