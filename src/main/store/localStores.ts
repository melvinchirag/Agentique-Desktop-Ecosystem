/**
 * Chip's nudges, Swarm's plans, Scout's research log and the biome_history answers, all on the local SQLite
 * file. Replaces the Tiger stores: nothing is in-memory-only any more, so follow-ups, plans and findings
 * survive a restart with no cloud database. Every method catches and logs; none throws into the app.
 */
import { randomUUID } from 'node:crypto';
import type { AgentId } from '../../shared/agents';
import type { HistoryKind, HistoryStore, Nudge, NudgeKind, NudgeStore } from '../runtime/types';
import type { LocalDb } from './localDb';

type Log = (m: string) => void;
const warn: Log = (m) => console.warn(`[local] ${m}`);

// ── Nudges ───────────────────────────────────────────────

export class LocalNudgeStore implements NudgeStore {
  constructor(private readonly db: LocalDb, private readonly log: Log = warn) {}

  async insert(n: Nudge): Promise<void> {
    try {
      // One nudge per (calendar event, kind): planning the same event twice replaces the old row.
      if (n.eventId) this.db.prepare(`DELETE FROM nudges WHERE event_id = ? AND kind = ?`).run(n.eventId, n.kind);
      this.db.prepare(`INSERT OR IGNORE INTO nudges (id, kind, about, question, ask_at, state, source, event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(n.id, n.kind, n.about, n.question, n.askAt.getTime(), n.state, n.source, n.eventId ?? null);
    } catch (e) { this.log(`nudge insert failed: ${(e as Error).message}`); }
  }

  async update(id: string, patch: Partial<Nudge>): Promise<void> {
    const columns: Partial<Record<keyof Nudge, string>> = { kind: 'kind', about: 'about', question: 'question', askAt: 'ask_at', state: 'state', source: 'source', eventId: 'event_id' };
    const sets: string[] = []; const params: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key as keyof Nudge];
      if (!column) continue;
      sets.push(`${column} = ?`);
      params.push(value instanceof Date ? value.getTime() : value == null ? null : String(value));
    }
    if (!sets.length) return;
    try { this.db.prepare(`UPDATE nudges SET ${sets.join(', ')} WHERE id = ?`).run(...params, id); }
    catch (e) { this.log(`nudge update failed: ${(e as Error).message}`); }
  }

  /** Pending or snoozed nudges whose time has come, oldest first. */
  async due(now: Date): Promise<Nudge[]> {
    return this.rows(`SELECT * FROM nudges WHERE state IN ('pending', 'snoozed') AND ask_at <= ? ORDER BY ask_at`, [now.getTime()]).map(nudgeFromRow);
  }

  async findByEvent(eventId: string, kind: NudgeKind): Promise<Nudge | null> {
    const row = this.rows(`SELECT * FROM nudges WHERE event_id = ? AND kind = ? AND state <> 'cancelled' LIMIT 1`, [eventId, kind])[0];
    return row ? nudgeFromRow(row) : null;
  }

  private rows(sql: string, params: (string | number)[]): Record<string, any>[] {
    try { return this.db.prepare(sql).all(...params) as Record<string, any>[]; }
    catch (e) { this.log(`nudge query failed: ${(e as Error).message}`); return []; }
  }
}

const nudgeFromRow = (r: Record<string, any>): Nudge => ({
  id: String(r.id), kind: r.kind, about: String(r.about), question: String(r.question), askAt: new Date(Number(r.ask_at)),
  ...(r.event_id ? { eventId: String(r.event_id) } : {}), state: r.state, source: r.source,
});

// ── Plans (Swarm) ────────────────────────────────────────

export type PlanStatus = 'planned' | 'done' | 'moved' | 'skipped';
export interface PlanStepInput { title: string; startAt?: Date; endAt?: Date }
export interface PlanStep {
  id: string; planId: string; goal: string; stepNo: number; title: string; status: PlanStatus;
  planDate: string;                              // YYYY-MM-DD, the user's local day
  startAt?: Date; endAt?: Date;
}
export interface PlanStore {
  savePlan(goal: string, steps: (string | PlanStepInput)[]): Promise<PlanStep[]>;
  markStep(id: string, status: PlanStatus): Promise<void>;
  today(): Promise<PlanStep[]>;
  completionToday(): Promise<{ done: number; total: number; text: string }>;
}
const STATUSES: PlanStatus[] = ['planned', 'done', 'moved', 'skipped'];

/** The user's local calendar day for a timestamp, as YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class LocalPlanStore implements PlanStore {
  constructor(private readonly db: LocalDb, private readonly now: () => number = Date.now, private readonly log: Log = warn) {}

  async savePlan(goal: string, steps: (string | PlanStepInput)[]): Promise<PlanStep[]> {
    const planId = randomUUID(); const planDate = localDay(this.now()); const createdAt = this.now();
    const saved: PlanStep[] = steps.map((raw, i) => {
      const step = typeof raw === 'string' ? { title: raw } : raw;
      return { id: randomUUID(), planId, goal, stepNo: i + 1, title: step.title, status: 'planned' as const, planDate,
        ...(step.startAt ? { startAt: step.startAt } : {}), ...(step.endAt ? { endAt: step.endAt } : {}) };
    });
    try {
      const insert = this.db.prepare(`INSERT INTO plan_items (id, plan_id, goal, step_no, plan_date, title, start_at, end_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)`);
      for (const s of saved) insert.run(s.id, planId, goal, s.stepNo, planDate, s.title, s.startAt?.getTime() ?? null, s.endAt?.getTime() ?? null, createdAt);
    } catch (e) { this.log(`plan save failed: ${(e as Error).message}`); }
    return saved;
  }

  async markStep(id: string, status: PlanStatus): Promise<void> {
    if (!STATUSES.includes(status)) return;
    try { this.db.prepare('UPDATE plan_items SET status = ? WHERE id = ?').run(status, id); }
    catch (e) { this.log(`plan mark failed: ${(e as Error).message}`); }
  }

  async today(): Promise<PlanStep[]> {
    try {
      return (this.db.prepare('SELECT * FROM plan_items WHERE plan_date = ? ORDER BY created_at, step_no').all(localDay(this.now())) as Record<string, any>[]).map((r) => ({
        id: String(r.id), planId: String(r.plan_id), goal: String(r.goal ?? ''), stepNo: Number(r.step_no) || 0, title: String(r.title),
        status: STATUSES.includes(r.status) ? r.status : 'planned', planDate: String(r.plan_date),
        ...(r.start_at ? { startAt: new Date(Number(r.start_at)) } : {}), ...(r.end_at ? { endAt: new Date(Number(r.end_at)) } : {}),
      }));
    } catch (e) { this.log(`plan query failed: ${(e as Error).message}`); return []; }
  }

  async completionToday(): Promise<{ done: number; total: number; text: string }> {
    const steps = (await this.today()).filter((s) => s.status !== 'moved');
    const done = steps.filter((s) => s.status === 'done').length;
    return { done, total: steps.length, text: steps.length ? `${done} of ${steps.length} done` : 'No plan today' };
  }
}

// ── Research (Scout) ─────────────────────────────────────

export interface ResearchEntry { ts: Date; title: string; sources: string[]; brief_path?: string }

export class LocalResearchStore {
  constructor(private readonly db: LocalDb, private readonly log: Log = warn) {}

  async record(title: string, sources: string[], briefPath?: string): Promise<void> {
    try { this.db.prepare('INSERT INTO research_log (id, ts, title, sources, brief_path) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), Date.now(), title, JSON.stringify(sources), briefPath ?? null); }
    catch (e) { this.log(`research record failed: ${(e as Error).message}`); }
  }

  async find(since: Date, query = ''): Promise<ResearchEntry[]> {
    try {
      const rows = this.db.prepare(`SELECT ts, title, sources, brief_path FROM research_log WHERE ts >= ? AND lower(title) LIKE ? ORDER BY ts DESC LIMIT 20`)
        .all(since.getTime(), `%${query.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`) as Record<string, any>[];
      return rows.map((r) => ({ ts: new Date(Number(r.ts)), title: String(r.title), sources: safeList(r.sources), ...(r.brief_path ? { brief_path: String(r.brief_path) } : {}) }));
    } catch (e) { this.log(`research lookup failed: ${(e as Error).message}`); return []; }
  }
}

const safeList = (v: unknown): string[] => { try { const j = JSON.parse(String(v)); return Array.isArray(j) ? j.map(String) : []; } catch { return []; } };

// ── biome_history (Chip's four fixed questions about the past) ──────────

const MAX_ROWS = 20;
const DEFAULT_SINCE_HOURS = 24;

export class LocalHistoryStore implements HistoryStore {
  constructor(private readonly db: LocalDb, private readonly now: () => number = Date.now, private readonly research?: LocalResearchStore, private readonly log: Log = warn) {}

  async query(kind: HistoryKind, sinceHours: number, agent?: AgentId): Promise<object[]> {
    const hours = Number.isFinite(sinceHours) && sinceHours > 0 ? sinceHours : DEFAULT_SINCE_HOURS;
    const since = this.now() - hours * 3600 * 1000;
    const a = agent ?? null;
    const findings = kind === 'agent_activity' && (!agent || agent === 'eagle')
      ? (await this.research?.find(new Date(since)) ?? []).map((row) => ({ agent: 'eagle', at: row.ts.toISOString(), title: row.title, findings: row.sources, brief_path: row.brief_path })) : [];
    try {
      let rows: Record<string, any>[] = [];
      if (kind === 'recent_tasks') rows = this.db.prepare(`
        SELECT min(ts) AS at,
               (SELECT json_extract(u.payload, '$.text') FROM events u WHERE u.task_id = e.task_id AND u.type = 'user.message' ORDER BY u.ts LIMIT 1) AS asked,
               (SELECT json_extract(s.payload, '$.text') FROM events s WHERE s.task_id = e.task_id AND s.type = 'agent.say' AND s.agent_id = 'chipmunk' ORDER BY s.ts DESC LIMIT 1) AS answered
        FROM events e WHERE e.ts >= ? AND e.task_id IS NOT NULL
          AND (? IS NULL OR e.task_id IN (SELECT task_id FROM events WHERE ts >= ? AND agent_id = ?))
        GROUP BY e.task_id HAVING sum(e.type = 'user.message') > 0 ORDER BY at DESC LIMIT ${MAX_ROWS}`).all(since, a, since, a) as Record<string, any>[];
      else if (kind === 'warden_blocks') rows = this.db.prepare(`
        SELECT e.ts AS at,
               (SELECT q.agent_id FROM events q WHERE q.type = 'tool.request' AND q.call_id = e.call_id ORDER BY q.ts DESC LIMIT 1) AS agent,
               (SELECT json_extract(q.payload, '$.tool') FROM events q WHERE q.type = 'tool.request' AND q.call_id = e.call_id ORDER BY q.ts DESC LIMIT 1) AS tool,
               json_extract(e.payload, '$.rule') AS rule, json_extract(e.payload, '$.reason') AS reason
        FROM events e WHERE e.type = 'wolf.verdict' AND json_extract(e.payload, '$.verdict') = 'deny' AND e.ts >= ?
        ORDER BY e.ts DESC LIMIT ${MAX_ROWS * 3}`).all(since) as Record<string, any>[];
      else if (kind === 'agent_activity') rows = this.db.prepare(`
        WITH j AS (SELECT json_extract(payload, '$.to') AS agent, sum(json_extract(payload, '$.state') = 'done') AS jobs, sum(json_extract(payload, '$.state') = 'failed') AS failed
                   FROM events WHERE type = 'job.update' AND ts >= ? GROUP BY agent),
             x AS (SELECT agent_id AS agent, count(*) AS actions FROM events WHERE type = 'tool.result' AND ts >= ? GROUP BY agent_id),
             ids AS (SELECT agent FROM j UNION SELECT agent FROM x)
        SELECT ids.agent, coalesce(j.jobs, 0) AS jobs, coalesce(j.failed, 0) AS failed, coalesce(x.actions, 0) AS actions
        FROM ids LEFT JOIN j ON j.agent = ids.agent LEFT JOIN x ON x.agent = ids.agent
        WHERE ids.agent IS NOT NULL AND (? IS NULL OR ids.agent = ?) AND coalesce(j.jobs, 0) + coalesce(j.failed, 0) + coalesce(x.actions, 0) > 0
        ORDER BY jobs DESC, actions DESC, ids.agent LIMIT ${MAX_ROWS}`).all(since, since, a, a) as Record<string, any>[];
      else if (kind === 'mood_history') rows = this.db.prepare(`
        SELECT date(ts / 1000, 'unixepoch', 'localtime') AS day, json_extract(payload, '$.mood') AS mood, count(*) AS times,
               round(avg(json_extract(payload, '$.intensity')), 2) AS avg_intensity
        FROM events WHERE type = 'user.mood' AND ts >= ? GROUP BY day, mood ORDER BY day DESC, times DESC LIMIT ${MAX_ROWS}`).all(since) as Record<string, any>[];
      if (kind === 'warden_blocks' && agent) rows = rows.filter((r) => r.agent === agent);
      return [...rows.slice(0, MAX_ROWS).map((r) => ({ ...r, ...(typeof r.at === 'number' ? { at: new Date(r.at).toISOString() } : {}) })), ...findings];
    } catch (e) { this.log(`history "${kind}" failed: ${(e as Error).message}`); return findings; }
  }
}
