/**
 * The event log and the Hub's read side, on the local SQLite file. Replaces TigerEventSink and TigerQueries
 * with the same contracts, so Timeline, Replay, Audit and Pulse work with no cloud database.
 */
import type { AgentId } from '../../shared/agents';
import type { BiomeEvent } from '../../shared/events';
import type { PulseResponse, WardenAuditRow } from '../../renderer/hub/responses';
import type { Bus, EventSink, TigerQueries } from '../runtime/types';
import type { LocalDb } from './localDb';
import { tx } from './localDb';
import { mapWardenAuditRow, type WardenCounts } from './wardenAudit';

/** Same privacy cap as v1: anything this big is probably an email body or file text. */
const MAX_PAYLOAD_BYTES = 4096;
const FLUSH_MS = 500;
const DAY = 86_400_000;

function split(e: BiomeEvent): { payload: Record<string, unknown>; callId: string | null } {
  const { id: _i, ts: _t, sessionId: _s, taskId: _k, agentId: _a, type: _y, ...payload } = e as BiomeEvent & Record<string, unknown>;
  return { payload, callId: typeof payload.callId === 'string' ? payload.callId : null };
}

function fromRow(row: Record<string, any>): BiomeEvent {
  const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
  return { ...payload, id: row.id, ts: Number(row.ts), sessionId: row.session_id, ...(row.task_id ? { taskId: row.task_id } : {}), agentId: row.agent_id, type: row.type } as BiomeEvent;
}

export class LocalEventSink implements EventSink {
  private buffer: BiomeEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly db: LocalDb, private readonly log: (m: string) => void = (m) => console.warn(`[events] ${m}`)) {}

  attach(bus: Bus): () => void { return bus.subscribe((e) => this.enqueue(e)); }

  enqueue(e: BiomeEvent): void {
    this.buffer.push(e);
    this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const batch = this.buffer; this.buffer = [];
    if (batch.length === 0) return;
    const insert = this.db.prepare('INSERT OR IGNORE INTO events (ts, id, session_id, task_id, agent_id, type, call_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    try {
      tx(this.db, () => {
        for (const e of batch) {
          const { payload, callId } = split(e);
          const body = JSON.stringify(payload);
          if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) { this.log(`dropped ${e.type}: payload over ${MAX_PAYLOAD_BYTES} bytes`); continue; }
          insert.run(e.ts, e.id, e.sessionId ?? null, e.taskId ?? null, e.agentId ?? null, e.type, callId, body);
        }
      });
    } catch (err) { this.log(`write failed: ${(err as Error).message}`); }
  }

  async dispose(): Promise<void> { await this.flush(); }
}

/** The Hub's queries. Never throw: a failed query logs and returns empty. */
export class LocalQueries implements TigerQueries {
  constructor(private readonly db: LocalDb, private readonly now: () => number = () => Date.now(), private readonly log: (m: string) => void = (m) => console.warn(`[events] ${m}`)) {}

  async taskEvents(taskId: string): Promise<BiomeEvent[]> {
    return this.rows('SELECT * FROM events WHERE task_id = ? ORDER BY ts, rowid', [taskId]).map(fromRow);
  }

  async timeline(fromTs: number, toTs: number, limit = 1000): Promise<BiomeEvent[]> {
    return this.rows('SELECT * FROM events WHERE ts >= ? AND ts <= ? ORDER BY ts, rowid LIMIT ?', [fromTs, toTs, Math.min(Math.max(1, limit), 5000)]).map(fromRow);
  }

  /** Same as v1's wolf_audit view: each verdict, alert or approval with the animal and tool from the matching tool.request. */
  async wardenAudit(limit: number): Promise<WardenAuditRow[]> {
    const n = Math.min(Math.max(1, Math.floor(limit) || 50), 200);
    return this.rows(`
      SELECT e.ts, e.task_id, e.agent_id, json_extract(e.payload, '$.verdict') AS verdict,
             json_extract(e.payload, '$.rule') AS rule, json_extract(e.payload, '$.reason') AS reason,
             (SELECT q.agent_id FROM events q WHERE q.type = 'tool.request' AND q.call_id = e.call_id ORDER BY q.ts DESC LIMIT 1) AS asking_agent,
             (SELECT json_extract(q.payload, '$.tool') FROM events q WHERE q.type = 'tool.request' AND q.call_id = e.call_id ORDER BY q.ts DESC LIMIT 1) AS tool
      FROM events e WHERE e.type IN ('wolf.verdict', 'wolf.alert', 'approval.resolve')
      ORDER BY e.ts DESC, e.rowid DESC LIMIT ?`, [n]).map((r) => mapWardenAuditRow({ ...r, ts: new Date(Number(r.ts)) }));
  }

  async pulse(): Promise<PulseResponse> {
    const now = this.now();
    const week = now - 7 * DAY, dayStart = Math.floor(now / DAY) * DAY;
    const mood = this.rows(`
      SELECT date(ts / 1000, 'unixepoch') AS day, json_extract(payload, '$.mood') AS mood, count(*) AS times,
             round(avg(json_extract(payload, '$.intensity')), 2) AS avg_intensity
      FROM events WHERE type = 'user.mood' AND ts >= ? GROUP BY day, mood ORDER BY day, times DESC`, [week]);
    const jobs = this.rows(`
      SELECT json_extract(payload, '$.to') AS agent,
             count(*) FILTER (WHERE json_extract(payload, '$.state') = 'done') AS done,
             count(*) FILTER (WHERE json_extract(payload, '$.state') = 'failed') AS failed
      FROM events WHERE type = 'job.update' AND ts >= ? GROUP BY agent ORDER BY done DESC, agent`, [week]);
    const activity = this.rows(`
      SELECT (ts / 300000) * 300000 AS bucket, agent_id AS agent, count(*) AS events,
             count(*) FILTER (WHERE type = 'tool.result') AS actions
      FROM events WHERE ts >= ? GROUP BY bucket, agent_id ORDER BY bucket, agent_id`, [now - DAY]);
    const warden: WardenCounts = { allowed: 0, asked: 0, denied: 0, alerts: 0 };
    const field: Record<string, keyof WardenCounts> = { allow: 'allowed', ask: 'asked', deny: 'denied', alert: 'alerts' };
    for (const r of this.rows(`SELECT coalesce(json_extract(payload, '$.verdict'), 'alert') AS verdict, count(*) AS times
                               FROM events WHERE type IN ('wolf.verdict', 'wolf.alert') AND ts >= ? GROUP BY verdict`, [dayStart])) {
      const f = field[String(r.verdict)];
      if (f) warden[f] = Number(r.times) || 0;
    }
    const jobsPerAgent: PulseResponse['jobsPerAgent'] = {};
    for (const r of jobs) if (r.agent) jobsPerAgent[r.agent as AgentId] = Number(r.done) || 0;
    return {
      moodWeek: mood.map((r) => ({ day: String(r.day), mood: String(r.mood ?? ''), score: Number(r.avg_intensity) || 0 })),
      jobsPerAgent, wardenBlocks: warden.denied, wardenAsks: warden.asked,
      mood, jobs, activity, warden, pixel: { draftsToday: 0, waiting: 0 },
    };
  }

  private rows(sql: string, params: (string | number)[]): Record<string, any>[] {
    try { return this.db.prepare(sql).all(...params) as Record<string, any>[]; }
    catch (err) { this.log(`query failed: ${(err as Error).message}`); return []; }
  }
}
