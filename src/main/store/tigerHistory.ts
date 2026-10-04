import type { AgentId } from '../../shared/agents';
import type { HistoryKind, HistoryStore } from '../runtime/types';
import { redact, type Db } from './tiger';

const MAX_ROWS = 20;
const DEFAULT_SINCE_HOURS = 24;

/** The four fixed `biome_history` templates (docs/SPONSORS.md §4.4). Parameterized; the LLM never writes SQL. */
const SQL: Record<HistoryKind, string> = {
  // First user message + Chip's last spoken line, per task.
  recent_tasks: `
    SELECT min(ts) AS at,
           (array_agg(payload->>'text' ORDER BY ts)      FILTER (WHERE type = 'user.message'))[1] AS asked,
           (array_agg(payload->>'text' ORDER BY ts DESC) FILTER (WHERE type = 'agent.say' AND agent_id = 'chipmunk'))[1] AS answered
    FROM biome_events
    WHERE ts >= $1 AND task_id IS NOT NULL
      AND ($2::text IS NULL OR task_id IN (SELECT task_id FROM biome_events WHERE ts >= $1 AND agent_id = $2))
    GROUP BY task_id
    HAVING count(*) FILTER (WHERE type = 'user.message') > 0
    ORDER BY at DESC LIMIT ${MAX_ROWS}`,
  // Warden's denials, with the animal and tool that asked (columns of the wolf_audit view).
  warden_blocks: `
    SELECT ts AS at, asking_agent AS agent, tool, rule, reason
    FROM wolf_audit
    WHERE type = 'wolf.verdict' AND verdict = 'deny' AND ts >= $1
      AND ($2::text IS NULL OR asking_agent = $2)
    ORDER BY ts DESC LIMIT ${MAX_ROWS}`,
  // Jobs from the daily aggregate, actions from the 5-minute aggregate. Archie's row also counts his file operations.
  agent_activity: `
    WITH j AS (SELECT agent, sum(done)::int AS jobs, sum(failed)::int AS failed
               FROM job_stats_daily WHERE day >= date_trunc('day', $1::timestamptz) GROUP BY agent),
         a AS (SELECT agent_id AS agent, sum(actions)::int AS actions
               FROM agent_activity_5m WHERE bucket >= $1 GROUP BY agent_id),
         f AS (SELECT 'beaver'::text AS agent, count(*)::int AS file_ops FROM file_ops WHERE ts >= $1 HAVING count(*) > 0),
         ids AS (SELECT agent FROM j UNION SELECT agent FROM a UNION SELECT agent FROM f)
    SELECT ids.agent, coalesce(j.jobs, 0) AS jobs, coalesce(j.failed, 0) AS failed, coalesce(a.actions, 0) AS actions, f.file_ops
    FROM ids LEFT JOIN j ON j.agent = ids.agent LEFT JOIN a ON a.agent = ids.agent LEFT JOIN f ON f.agent = ids.agent
    WHERE ($2::text IS NULL OR ids.agent = $2)
      AND coalesce(j.jobs, 0) + coalesce(j.failed, 0) + coalesce(a.actions, 0) + coalesce(f.file_ops, 0) > 0
    ORDER BY jobs DESC, actions DESC, ids.agent LIMIT ${MAX_ROWS}`,
  // The user's mood per day ($2 is unused: the aggregate is about the user, not an animal).
  mood_history: `
    SELECT day, mood, times::int AS times, round(avg_intensity::numeric, 2)::float AS avg_intensity
    FROM mood_daily
    WHERE day >= date_trunc('day', $1::timestamptz) AND ($2::text IS NULL OR true)
    ORDER BY day DESC, times DESC LIMIT ${MAX_ROWS}`,
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

/** Tiger-backed HistoryStore. Replaces the in-memory one at handoff. Returns [] if Tiger is unreachable. */
export class TigerHistoryStore implements HistoryStore {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now, private readonly log: (m: string) => void = (m) => console.warn(`[tiger] ${m}`)) {}

  async query(kind: HistoryKind, sinceHours: number, agent?: AgentId): Promise<object[]> {
    const sql = SQL[kind];
    if (!sql) return [];
    const hours = Number.isFinite(sinceHours) && sinceHours > 0 ? sinceHours : DEFAULT_SINCE_HOURS;
    const since = new Date(this.now() - hours * 3600 * 1000);
    try {
      const { rows } = await this.db.query(sql, [since, agent ?? null]);
      // file_ops is only present on Archie's row; drop the empty column from the others.
      return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => !(k === 'file_ops' && v == null)).map(([k, v]) => [k, iso(v)])));
    } catch (err) {
      this.log(`history query "${kind}" failed: ${redact((err as Error).message)}`);
      return [];
    }
  }
}
