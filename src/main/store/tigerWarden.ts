import { redact, type Db } from './tiger';

/** Rows for Warden's inspect card and the Audit tab (03-warden-security.md §8). */
export const WARDEN_AUDIT_SQL =
  'SELECT ts, task_id, agent_id, type, call_id, verdict, rule, reason, approved, asking_agent, tool, how FROM wolf_audit ORDER BY ts DESC LIMIT $1';

/** What Warden did today: the four numbers on his inspect card. */
export interface WardenCounts { allowed: number; asked: number; denied: number; alerts: number }

const ZERO: WardenCounts = { allowed: 0, asked: 0, denied: 0, alerts: 0 };
const FIELD: Record<string, keyof WardenCounts> = { allow: 'allowed', ask: 'asked', deny: 'denied', alert: 'alerts' };

/**
 * Today's counts from the warden_daily aggregate. "Today" is the current UTC day, because the aggregate
 * buckets by UTC day. Returns zeros if Tiger is unreachable. Never throws.
 */
export async function wardenToday(db: Db, log: (m: string) => void = (m) => console.warn(`[tiger] ${m}`)): Promise<WardenCounts> {
  const counts = { ...ZERO };
  try {
    const { rows } = await db.query(`SELECT verdict, sum(times)::int AS times FROM warden_daily WHERE day >= date_trunc('day', now()) GROUP BY verdict`);
    for (const row of rows) {
      const field = FIELD[row.verdict as string];
      if (field) counts[field] = Number(row.times) || 0;
    }
  } catch (err) { log(`warden counts failed: ${redact((err as Error).message)}`); }
  return counts;
}
