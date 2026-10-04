import { randomUUID } from 'node:crypto';
import { redact, type Db } from './tiger';

// The DraftsLog contract (04-pixel-workspace.md §5.2). `contracts/pixel` adds these to runtime/types.ts;
// until it merges they are declared here with the same shape, so the class already satisfies the contract.
export interface DraftRecord { gmailDraftId: string; ts: number; toCount: number; subject: string; state: 'waiting' | 'sent' | 'deleted' }
export interface DraftsLog {
  record(d: Omit<DraftRecord, 'state'>): Promise<void>;
  setState(gmailDraftId: string, state: 'sent' | 'deleted'): Promise<void>;
  waiting(olderThanMs: number): Promise<DraftRecord[]>;
}

const SUBJECT_STORED = 120;      // what the table keeps
const SUBJECT_REJECT = 200;      // anything longer is not a subject
type Log = (m: string) => void;
const defaultLog: Log = (m) => console.warn(`[tiger] ${m}`);

/** Returns the subject to store, or null when the text looks like an email body and must not be stored at all. */
export function safeSubject(subject: string): string | null {
  const text = String(subject ?? '');
  if (text.length > SUBJECT_REJECT || /[\r\n]/.test(text.trim())) return null;
  return text.trim().slice(0, SUBJECT_STORED);
}

/**
 * Pixel's drafts in Tiger (metadata only: draft id, recipient COUNT, short subject, state).
 * This is the COPY: Melvin's local log is primary. It powers the waiting-drafts nudge and Pulse.
 * Never throws into the app: a failed write is logged and dropped, a failed read returns [].
 */
export class TigerDraftsLog implements DraftsLog {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now, private readonly log: Log = defaultLog) {}

  /** One row per Gmail draft: recording the same draft again updates it and keeps its state. */
  async record(d: Omit<DraftRecord, 'state'>): Promise<void> {
    const subject = safeSubject(d.subject);
    if (subject === null) { this.log('dropped a draft record: the subject looks like an email body'); return; }
    await this.run('record',
      `INSERT INTO drafts_log (id, ts, gmail_draft_id, to_count, subject, state) VALUES ($1, $2, $3, $4, $5, 'waiting')
       ON CONFLICT (gmail_draft_id) DO UPDATE SET ts = EXCLUDED.ts, to_count = EXCLUDED.to_count, subject = EXCLUDED.subject`,
      [randomUUID(), new Date(d.ts), d.gmailDraftId, Math.max(0, Math.floor(d.toCount) || 0), subject]);
  }

  async setState(gmailDraftId: string, state: 'sent' | 'deleted'): Promise<void> {
    if (state !== 'sent' && state !== 'deleted') return;
    await this.run('setState', 'UPDATE drafts_log SET state = $2 WHERE gmail_draft_id = $1', [gmailDraftId, state]);
  }

  /** Drafts still waiting that were written more than `olderThanMs` ago, oldest first. */
  async waiting(olderThanMs: number): Promise<DraftRecord[]> {
    const cutoff = new Date(this.now() - Math.max(0, olderThanMs || 0));
    const rows = await this.run('waiting',
      `SELECT gmail_draft_id, ts, to_count, subject, state FROM drafts_log WHERE state = 'waiting' AND ts <= $1 ORDER BY ts LIMIT 100`, [cutoff]);
    return (rows ?? []).map((r) => ({ gmailDraftId: r.gmail_draft_id, ts: new Date(r.ts).getTime(), toCount: r.to_count ?? 0, subject: r.subject ?? '', state: r.state }));
  }

  private async run(what: string, sql: string, params: unknown[]): Promise<Record<string, any>[] | null> {
    try { return (await this.db.query(sql, params)).rows; }
    catch (err) { this.log(`drafts ${what} failed: ${redact((err as Error).message)}`); return null; }
  }
}

/** Pixel's numbers for the Hub: drafts written today (UTC day) and drafts still waiting. Zeros if Tiger is unreachable. */
export async function pixelToday(db: Db, log: Log = defaultLog): Promise<{ draftsToday: number; waiting: number }> {
  try {
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE ts >= date_trunc('day', now()))::int AS drafts_today, count(*) FILTER (WHERE state = 'waiting')::int AS waiting FROM drafts_log`);
    return { draftsToday: Number(rows[0]?.drafts_today) || 0, waiting: Number(rows[0]?.waiting) || 0 };
  } catch (err) { log(`pixel counts failed: ${redact((err as Error).message)}`); return { draftsToday: 0, waiting: 0 }; }
}
