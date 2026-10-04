import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileOp, FileOpsJournal } from '../../runtime/types';
import { RealClock } from '../../runtime/clock';

type JournalMarker =
  | { kind: 'undone'; batchId: string; ts: number }
  | { kind: 'swept'; batchId: string; ts: number };
type JournalRow = FileOp | JournalMarker;

/** Options for {@link LocalFileOpsJournal}. */
export interface LocalFileOpsJournalOptions {
  /** Supplies marker timestamps. Defaults to the application's real clock. */
  clock?: Pick<RealClock, 'now'>;
}

/** Append-only JSONL implementation of the primary, restart-safe file-operations journal. */
export class LocalFileOpsJournal implements FileOpsJournal {
  private readonly now: () => number;

  constructor(private readonly filePath: string, options: LocalFileOpsJournalOptions = {}) {
    this.now = options.clock ? () => options.clock!.now() : () => new RealClock().now();
  }

  /** Append an immutable filesystem operation row. */
  async record(op: FileOp): Promise<void> {
    await this.append(op);
  }

  /** Return the most recently recorded batch containing an undoable change. */
  async lastBatch(): Promise<string | null> {
    const { ops, undone, swept } = await this.readState();
    for (let i = ops.length - 1; i >= 0; i -= 1) {
      const batchId = ops[i].batchId;
      if (!undone.has(batchId) && !swept.has(batchId) && ops[i].op !== 'sweep') return batchId;
    }
    return null;
  }

  /** Return a batch's operation rows in journal order, with appended markers folded in. */
  async batchOps(batchId: string): Promise<FileOp[]> {
    const state = await this.readState();
    return state.ops
      .filter((op) => op.batchId === batchId)
      .map((op) => ({ ...op, undone: state.undone.has(batchId), swept: state.swept.has(batchId) || op.swept }));
  }

  /** Append a marker; prior operation rows remain untouched. */
  async markUndone(batchId: string): Promise<void> {
    await this.append({ kind: 'undone', batchId, ts: this.now() });
  }

  /** Return operations at or after the requested age cutoff, newest first. */
  async recent(sinceHours: number): Promise<FileOp[]> {
    if (!Number.isFinite(sinceHours) || sinceHours < 0) throw new RangeError('sinceHours must be a non-negative number');
    const cutoff = this.now() - sinceHours * 60 * 60 * 1000;
    const state = await this.readState();
    return state.ops
      .filter((op) => op.ts >= cutoff)
      .map((op) => ({ ...op, undone: state.undone.has(op.batchId), swept: state.swept.has(op.batchId) || op.swept }))
      .sort((a, b) => b.ts - a.ts);
  }

  /** Find unswept, not-undone trash batches whose trash operations predate `days`. */
  async trashBatchesOlderThan(days: number): Promise<string[]> {
    if (!Number.isFinite(days) || days < 0) throw new RangeError('days must be a non-negative number');
    const cutoff = this.now() - days * 24 * 60 * 60 * 1000;
    const state = await this.readState();
    const batches = new Map<string, number>();
    for (const op of state.ops) {
      if (op.op !== 'trash' || state.undone.has(op.batchId) || state.swept.has(op.batchId)) continue;
      batches.set(op.batchId, Math.max(batches.get(op.batchId) ?? -Infinity, op.ts));
    }
    return [...batches.entries()]
      .filter(([, latestTs]) => latestTs < cutoff)
      .sort((a, b) => a[1] - b[1])
      .map(([batchId]) => batchId);
  }

  /** Append the sweep operation and marker so a restart cannot select the batch again. */
  async markSwept(batchId: string): Promise<void> {
    const ts = this.now();
    const sweepOp: FileOp = {
      id: `sweep:${batchId}:${ts}`,
      ts,
      jobId: 'system:sweep',
      batchId,
      op: 'sweep',
      undone: false,
      swept: true,
    };
    await this.append(sweepOp);
    await this.append({ kind: 'swept', batchId, ts });
  }

  private async append(row: JournalRow): Promise<void> {
    await mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(row)}\n`, 'utf8');
  }

  private async readState(): Promise<{ ops: FileOp[]; undone: Set<string>; swept: Set<string> }> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return { ops: [], undone: new Set(), swept: new Set() };
      throw error;
    }

    const ops: FileOp[] = [];
    const undone = new Set<string>();
    const swept = new Set<string>();
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        throw new Error(`Invalid journal JSON on line ${index + 1}`);
      }
      if (isMarker(row)) {
        if (row.kind === 'undone') undone.add(row.batchId);
        else swept.add(row.batchId);
      } else if (isFileOp(row)) {
        ops.push(row);
        if (row.swept || row.op === 'sweep') swept.add(row.batchId);
        if (row.undone) undone.add(row.batchId);
      } else {
        throw new Error(`Invalid journal row on line ${index + 1}`);
      }
    }
    return { ops, undone, swept };
  }
}

/** Short constructor for callers that prefer a factory. */
export function createLocalFileOpsJournal(filePath: string, options?: LocalFileOpsJournalOptions): FileOpsJournal {
  return new LocalFileOpsJournal(filePath, options);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isMarker(value: unknown): value is JournalMarker {
  if (typeof value !== 'object' || value === null || !('kind' in value) || !('batchId' in value) || !('ts' in value)) return false;
  const row = value as Record<string, unknown>;
  return (row.kind === 'undone' || row.kind === 'swept') && typeof row.batchId === 'string' && typeof row.ts === 'number';
}

function isFileOp(value: unknown): value is FileOp {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && typeof row.ts === 'number' && typeof row.jobId === 'string'
    && typeof row.batchId === 'string' && ['move', 'rename', 'mkdir', 'trash', 'sweep'].includes(String(row.op))
    && typeof row.undone === 'boolean';
}
