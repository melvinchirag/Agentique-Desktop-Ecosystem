import type { FileOp, FileOpsJournal } from '../../runtime/types';

/** A journal that can also wait for its Tiger copy to catch up (tests and shutdown). */
export interface CompositeJournal extends FileOpsJournal {
  /** Resolves when every queued Tiger write has finished (or failed and been logged). Never rejects. */
  flush(): Promise<void>;
}

/**
 * Archie spec §5: the local journal is the source of truth for undo; Tiger holds a copy.
 * Every write goes to local first (a local failure reaches the caller: no local row, no file change),
 * then to Tiger fire-and-forget, in order, and a Tiger failure never reaches the caller.
 * Every read comes from local. With no Tiger journal this is just the local journal.
 */
export function createCompositeJournal(
  local: FileOpsJournal,
  tiger?: FileOpsJournal,
  log: (message: string) => void = (message) => console.warn(`[journal] ${message}`),
): CompositeJournal {
  let tail: Promise<void> = Promise.resolve();
  /** Queue one Tiger write behind the earlier ones, so a later `markUndone` never overtakes its own `record`. */
  const mirror = (what: string, write: (copy: FileOpsJournal) => Promise<void>): void => {
    if (!tiger) return;
    tail = tail.then(() => write(tiger)).catch(() => {
      // Driver errors may contain connection strings. Never stringify the rejection.
      // Even a broken logger must not poison the queue or turn flush into a failure.
      try { log(`Tiger copy of ${what} failed`); } catch { /* optional mirror diagnostics */ }
    });
  };

  return {
    async record(op: FileOp): Promise<void> {
      await local.record(op);
      // The mirror may run after the caller has reused or mutated its object.
      // Capture the row that succeeded locally before placing it on the queue.
      const mirroredOp = { ...op };
      mirror('record', (copy) => copy.record(mirroredOp));
    },
    lastBatch: () => local.lastBatch(),
    batchOps: (batchId) => local.batchOps(batchId),
    async markUndone(batchId: string): Promise<void> {
      await local.markUndone(batchId);
      mirror('markUndone', (copy) => copy.markUndone(batchId));
    },
    recent: (sinceHours) => local.recent(sinceHours),
    trashBatchesOlderThan: (days) => local.trashBatchesOlderThan(days),
    async markSwept(batchId: string): Promise<void> {
      await local.markSwept(batchId);
      mirror('markSwept', (copy) => copy.markSwept(batchId));
    },
    flush: () => tail,
  };
}
