import type { Nudge, NudgeKind, NudgeStore } from '../runtime/types';
import { redact, type Db } from './tiger';

const COLUMNS = 'id, kind, about, question, ask_at, state, source, event_id';

const fromRow = (r: Record<string, any>): Nudge => ({
  id: r.id, kind: r.kind, about: r.about, question: r.question, askAt: new Date(r.ask_at),
  ...(r.event_id ? { eventId: r.event_id } : {}), state: r.state, source: r.source,
});
const copy = (n: Nudge): Nudge => ({ ...n, askAt: new Date(n.askAt) });

const PATCH_COLUMNS: Partial<Record<keyof Nudge, string>> = {
  kind: 'kind', about: 'about', question: 'question', askAt: 'ask_at', state: 'state', source: 'source', eventId: 'event_id',
};

/**
 * Chip's nudges in Tiger, so follow-ups survive a restart (docs/SPONSORS.md §1.3).
 * Same behaviour as the in-memory store. A local copy keeps nudges working while Tiger is unreachable:
 * writes go to both, reads fall back to the copy. Never throws.
 */
export class TigerNudgeStore implements NudgeStore {
  private readonly local = new Map<string, Nudge>();

  constructor(private readonly db: Db, private readonly log: (m: string) => void = (m) => console.warn(`[tiger] ${m}`)) {}

  async insert(n: Nudge): Promise<void> {
    this.local.set(n.id, copy(n));
    const params = [n.id, n.kind, n.about, n.question, n.askAt, n.state, n.source, n.eventId ?? null];
    // One nudge per (calendar event, kind): planning the same event twice replaces the old row.
    const conflict = n.eventId
      ? 'ON CONFLICT (event_id, kind) DO UPDATE SET id = EXCLUDED.id, about = EXCLUDED.about, question = EXCLUDED.question, ask_at = EXCLUDED.ask_at, state = EXCLUDED.state, source = EXCLUDED.source'
      : 'ON CONFLICT (id) DO NOTHING';
    await this.run('insert', `INSERT INTO nudges (${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ${conflict}`, params);
  }

  async update(id: string, patch: Partial<Nudge>): Promise<void> {
    const found = this.local.get(id);
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [key, value] of Object.entries(patch)) {
      const column = PATCH_COLUMNS[key as keyof Nudge];
      if (!column) continue;                               // id is never changed
      params.push(value ?? null);
      sets.push(`${column} = $${params.length}`);
      if (found) (found as any)[key] = key === 'askAt' ? new Date(value as Date) : value;
    }
    if (sets.length) await this.run('update', `UPDATE nudges SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  /** Pending or snoozed nudges whose time has come, oldest first. */
  async due(now: Date): Promise<Nudge[]> {
    const rows = await this.run('due', `SELECT ${COLUMNS} FROM nudges WHERE state IN ('pending', 'snoozed') AND ask_at <= $1 ORDER BY ask_at`, [now]);
    if (rows) return rows.map(fromRow);
    return [...this.local.values()]
      .filter((n) => (n.state === 'pending' || n.state === 'snoozed') && n.askAt.getTime() <= now.getTime())
      .sort((a, b) => a.askAt.getTime() - b.askAt.getTime()).map(copy);
  }

  async findByEvent(eventId: string, kind: NudgeKind): Promise<Nudge | null> {
    const rows = await this.run('findByEvent', `SELECT ${COLUMNS} FROM nudges WHERE event_id = $1 AND kind = $2 AND state <> 'cancelled' LIMIT 1`, [eventId, kind]);
    if (rows) return rows[0] ? fromRow(rows[0]) : null;
    const found = [...this.local.values()].find((n) => n.eventId === eventId && n.kind === kind && n.state !== 'cancelled');
    return found ? copy(found) : null;
  }

  /** Returns the rows, or null when Tiger failed (callers then use the local copy). */
  private async run(what: string, sql: string, params: unknown[]): Promise<Record<string, any>[] | null> {
    try { return (await this.db.query(sql, params)).rows; }
    catch (err) { this.log(`nudge ${what} failed: ${redact((err as Error).message)}`); return null; }
  }
}
