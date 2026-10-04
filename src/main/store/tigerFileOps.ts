import type { FileOp, FileOpsJournal } from '../runtime/types';
import { redact, type Db } from './tiger';

const COLUMNS = 'id, ts, job_id, op, from_path, to_path, batch_id, undone, swept';
const MAX_RECENT = 200;

const fromRow = (r: Record<string, any>): FileOp => ({
  id: r.id, ts: new Date(r.ts).getTime(), jobId: r.job_id, batchId: r.batch_id, op: r.op,
  ...(r.from_path != null ? { fromPath: r.from_path } : {}),
  ...(r.to_path != null ? { toPath: r.to_path } : {}),
  undone: !!r.undone,
  ...(r.swept ? { swept: true } : {}),
});

/**
 * Archie's file-operation journal in Tiger (02-archie-files.md §5).
 * This is the COPY: Melvin's local file-ops.jsonl is the source of truth for undo. The copy powers history,
 * Pulse, and biome_history, and is the fallback when the local file is missing.
 * Never throws into the app: a failed write is logged and dropped, a failed read returns empty.
 */
export class TigerFileOpsJournal implements FileOpsJournal {
  private lastMicros = 0;

  constructor(private readonly db: Db, private readonly now: () => number = Date.now,
              private readonly log: (m: string) => void = (m) => console.warn(`[tiger] ${m}`)) {}

  async record(op: FileOp): Promise<void> {
    await this.run('record',
      `INSERT INTO file_ops (${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [op.id, this.orderedTs(op.ts), op.jobId, op.op, op.fromPath ?? null, op.toPath ?? null, op.batchId, op.undone, op.swept ?? false]);
  }

  /** The newest batch that can still be undone (not undone, not swept to the Recycle Bin). */
  async lastBatch(): Promise<string | null> {
    const rows = await this.run('lastBatch',
      `SELECT batch_id FROM file_ops WHERE undone = false AND coalesce(swept, false) = false AND op <> 'sweep' AND batch_id IS NOT NULL ORDER BY ts DESC LIMIT 1`);
    return rows?.[0]?.batch_id ?? null;
  }

  /** Every operation of one batch, in the order it happened (undo walks it backwards). */
  async batchOps(batchId: string): Promise<FileOp[]> {
    return ((await this.run('batchOps', `SELECT ${COLUMNS} FROM file_ops WHERE batch_id = $1 ORDER BY ts`, [batchId])) ?? []).map(fromRow);
  }

  async markUndone(batchId: string): Promise<void> {
    await this.run('markUndone', 'UPDATE file_ops SET undone = true WHERE batch_id = $1', [batchId]);
  }

  /** "What did Archie move today?" Newest first. */
  async recent(sinceHours: number): Promise<FileOp[]> {
    const hours = Number.isFinite(sinceHours) && sinceHours > 0 ? sinceHours : 24;
    const since = new Date(this.now() - hours * 3600 * 1000);
    return ((await this.run('recent', `SELECT ${COLUMNS} FROM file_ops WHERE ts >= $1 ORDER BY ts DESC LIMIT ${MAX_RECENT}`, [since])) ?? []).map(fromRow);
  }

  /** Soft-trash batches whose newest operation is older than `days`: the 7-day sweep to the Recycle Bin. */
  async trashBatchesOlderThan(days: number): Promise<string[]> {
    const cutoff = new Date(this.now() - days * 24 * 3600 * 1000);
    const rows = await this.run('trashBatchesOlderThan',
      `SELECT batch_id FROM file_ops WHERE op = 'trash' AND undone = false AND coalesce(swept, false) = false AND batch_id IS NOT NULL
       GROUP BY batch_id HAVING max(ts) < $1 ORDER BY max(ts)`, [cutoff]);
    return (rows ?? []).map((r) => r.batch_id);
  }

  async markSwept(batchId: string): Promise<void> {
    await this.run('markSwept', 'UPDATE file_ops SET swept = true WHERE batch_id = $1', [batchId]);
  }

  /** Operations logged in the same millisecond are stored 1 microsecond apart, so a batch keeps its order. */
  private orderedTs(ms: number): string {
    this.lastMicros = Math.max(ms * 1000, this.lastMicros + 1);
    return new Date(Math.floor(this.lastMicros / 1000)).toISOString().replace('Z', String(this.lastMicros % 1000).padStart(3, '0') + 'Z');
  }

  /** Returns the rows, or null when Tiger failed. */
  private async run(what: string, sql: string, params: unknown[] = []): Promise<Record<string, any>[] | null> {
    try { return (await this.db.query(sql, params)).rows; }
    catch (err) { this.log(`file-ops ${what} failed: ${redact((err as Error).message)}`); return null; }
  }
}
