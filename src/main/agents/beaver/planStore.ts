import type { Clock } from '../../runtime/types';

/** Plans live for 30 minutes (Archie spec §4.2). */
export const PLAN_TTL_MS = 30 * 60 * 1000;
/** Expired plans are remembered this long so a late apply gets PLAN_EXPIRED rather than PLAN_NOT_FOUND. */
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

/** One checked move. Paths are absolute and canonical (from `safePath`). */
export interface PlannedMove {
  from: string;
  /** Full destination path, already clash-named against the disk and the rest of the plan. */
  to: string;
  /** Source modified time at planning; apply skips the file if it changed since. */
  modifiedAt: number;
}

export interface SkippedItem { path: string; reason: string }

export interface OrganizePlan {
  planId: string;
  title: string;
  moves: PlannedMove[];
  skipped: SkippedItem[];
  /** Distinct destination folders (absolute), in first-use order. */
  folders: string[];
  /** How many of `folders` did not exist at planning (for the approval preview). */
  newFolderCount: number;
  /** Where the plan works, e.g. `Downloads` (for the approval preview). */
  where?: string;
  createdAt: number;
  expiresAt: number;
}

export type PlanLookup =
  | { ok: true; plan: OrganizePlan }
  | { ok: false; error: 'PLAN_NOT_FOUND' | 'PLAN_EXPIRED' | 'PLAN_ALREADY_APPLIED' };

interface StoredPlan { plan: OrganizePlan; applied: boolean }

/** In-memory plan store. Time comes from the injected clock; no timers are scheduled. */
export class PlanStore {
  private readonly plans = new Map<string, StoredPlan>();

  constructor(private readonly clock: Clock, private readonly ttlMs = PLAN_TTL_MS) {}

  /** Store a plan; `createdAt`/`expiresAt` are set here. */
  put(plan: Omit<OrganizePlan, 'createdAt' | 'expiresAt'>): OrganizePlan {
    this.prune();
    const createdAt = this.clock.now();
    const stored: OrganizePlan = { ...plan, createdAt, expiresAt: createdAt + this.ttlMs };
    this.plans.set(plan.planId, { plan: stored, applied: false });
    return stored;
  }

  /** Synchronous lookup (approval previews need it). Does not consume the plan. */
  get(planId: unknown): PlanLookup {
    if (typeof planId !== 'string') return { ok: false, error: 'PLAN_NOT_FOUND' };
    const stored = this.plans.get(planId);
    if (!stored) return { ok: false, error: 'PLAN_NOT_FOUND' };
    if (stored.applied) return { ok: false, error: 'PLAN_ALREADY_APPLIED' };
    if (this.clock.now() >= stored.plan.expiresAt) return { ok: false, error: 'PLAN_EXPIRED' };
    return { ok: true, plan: stored.plan };
  }

  /** Look up and mark applied in one synchronous step, so a plan can never run twice. */
  take(planId: unknown): PlanLookup {
    const found = this.get(planId);
    if (found.ok) this.plans.get(found.plan.planId)!.applied = true;
    return found;
  }

  private prune(): void {
    const cutoff = this.clock.now() - FORGET_AFTER_MS;
    for (const [id, stored] of this.plans) if (stored.plan.expiresAt < cutoff) this.plans.delete(id);
  }
}
