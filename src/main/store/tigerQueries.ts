import type { BiomeEvent } from '../../shared/events';
import type { AgentId } from '../../shared/agents';
import type { PulseResponse, WardenAuditRow } from '../../renderer/hub/responses';
import type { TigerQueries as TigerQueriesContract } from '../runtime/types';
import { fromRow, redact, type Db } from './tiger';
import { pixelToday } from './tigerDrafts';
import { WARDEN_AUDIT_SQL, mapWardenAuditRow, wardenToday } from './tigerWarden';

const EVENT_COLUMNS = 'ts, id, session_id, task_id, agent_id, type, payload';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read side for the Hub: Biome Replay, Warden's Audit, Biome Pulse (docs/SPONSORS.md §4.3).
 * Returns empty results if Tiger is unreachable. Never throws.
 */
export class TigerQueries implements TigerQueriesContract {
  constructor(private readonly db: Db, private readonly log: (m: string) => void = (m) => console.warn(`[tiger] ${m}`)) {}

  /** Every event of one user request, in order. Replay plays these back. */
  async taskEvents(taskId: string): Promise<BiomeEvent[]> {
    if (!UUID.test(taskId)) return [];
    return (await this.rows('taskEvents', `SELECT ${EVENT_COLUMNS} FROM biome_events WHERE task_id = $1 ORDER BY ts`, [taskId])).map(fromRow);
  }

  /** Events in a time range (epoch ms), oldest first. Backs AdeApi.getTimeline. */
  async timeline(fromTs: number, toTs: number, limit = 1000): Promise<BiomeEvent[]> {
    return (await this.rows('timeline', `SELECT ${EVENT_COLUMNS} FROM biome_events WHERE ts >= $1 AND ts <= $2 ORDER BY ts LIMIT $3`,
      [new Date(fromTs), new Date(toTs), Math.min(Math.max(1, limit), 5000)])).map(fromRow);
  }

  /** Warden's latest verdicts, alerts, and approvals, each with the animal that asked and the tool it wanted. */
  async wardenAudit(limit: number): Promise<WardenAuditRow[]> {
    const n = Math.min(Math.max(1, Math.floor(limit) || 50), 200);
    return (await this.rows('wardenAudit', WARDEN_AUDIT_SQL, [n])).map(mapWardenAuditRow);
  }

  /** Mood this week, jobs per animal this week, activity over the last day, Warden's counts for today, and Pixel's draft counts. */
  async pulse(): Promise<PulseResponse> {
    const [mood, jobs, activity, warden, pixel] = await Promise.all([
      this.rows('pulse.mood', `SELECT day, mood, times::int AS times, round(avg_intensity::numeric, 2)::float AS avg_intensity
                               FROM mood_daily WHERE day >= now() - INTERVAL '7 days' ORDER BY day, times DESC`),
      this.rows('pulse.jobs', `SELECT agent, sum(done)::int AS done, sum(failed)::int AS failed
                               FROM job_stats_daily WHERE day >= now() - INTERVAL '7 days' GROUP BY agent ORDER BY done DESC, agent`),
      this.rows('pulse.activity', `SELECT bucket, agent_id AS agent, events::int AS events, actions::int AS actions
                                   FROM agent_activity_5m WHERE bucket >= now() - INTERVAL '24 hours' ORDER BY bucket, agent_id`),
      wardenToday(this.db, this.log),
      pixelToday(this.db, this.log),
    ]);
    const moodWeek = mood.map((row) => ({
      day: new Date(row.day).toISOString().slice(0, 10),
      mood: String(row.mood ?? ''),
      score: Number(row.avg_intensity) || 0,
    }));
    const jobsPerAgent: PulseResponse['jobsPerAgent'] = {};
    for (const row of jobs) {
      if (row.agent) jobsPerAgent[row.agent as AgentId] = Number(row.done) || 0;
    }
    return {
      moodWeek, jobsPerAgent, wardenBlocks: warden.denied, wardenAsks: warden.asked,
      mood, jobs, activity, warden, pixel,
    };
  }

  private async rows(what: string, sql: string, params: unknown[] = []): Promise<Record<string, any>[]> {
    try { return (await this.db.query(sql, params)).rows; }
    catch (err) { this.log(`${what} failed: ${redact((err as Error).message)}`); return []; }
  }
}
