import { describe, expect, it } from 'vitest';
import type { FileOp } from '../src/main/runtime/types';
import type { Db } from '../src/main/store/tiger';
import { TigerFileOpsJournal } from '../src/main/store/tigerFileOps';
import { TigerHistoryStore } from '../src/main/store/tigerHistory';

class FakeDb implements Db {
  calls: { text: string; params: any[] }[] = [];
  down = false;
  rows: any[] = [];
  async query(text: string, params: any[] = []) {
    if (this.down) throw new Error('connect ECONNREFUSED postgres://user:secret@host/db');
    this.calls.push({ text, params });
    return { rows: this.rows };
  }
}
const NOW = Date.UTC(2026, 9, 4, 12);
const quiet = () => {};
const op = (over: Partial<FileOp> = {}): FileOp => ({ id: 'op-1', ts: NOW, jobId: 'job-1', batchId: 'batch-1', op: 'move', fromPath: 'C:/Users/s/Downloads/a.pdf', toPath: 'C:/Users/s/Documents/a.pdf', undone: false, ...over });
const journal = (db: FakeDb) => new TigerFileOpsJournal(db, () => NOW, quiet);

describe('TigerFileOpsJournal writes', () => {
  it('record inserts every column and ignores a repeated id', async () => {
    const db = new FakeDb();
    await journal(db).record(op());
    expect(db.calls[0]!.text).toMatch(/INSERT INTO file_ops \(id, ts, job_id, op, from_path, to_path, batch_id, undone, swept\).*ON CONFLICT \(id\) DO NOTHING/s);
    expect(db.calls[0]!.params).toEqual(['op-1', '2026-10-04T12:00:00.000000Z', 'job-1', 'move', 'C:/Users/s/Downloads/a.pdf', 'C:/Users/s/Documents/a.pdf', 'batch-1', false, false]);
  });

  it('accepts trash and sweep, and mkdir with no source path', async () => {
    const db = new FakeDb();
    const j = journal(db);
    await j.record(op({ id: 'a', op: 'trash' }));
    await j.record(op({ id: 'b', op: 'sweep', swept: true }));
    await j.record(op({ id: 'c', op: 'mkdir', fromPath: undefined }));
    expect(db.calls.map((c) => c.params[3])).toEqual(['trash', 'sweep', 'mkdir']);
    expect(db.calls[1]!.params[8]).toBe(true);
    expect(db.calls[2]!.params[4]).toBeNull();
  });

  it('operations in the same millisecond keep their order', async () => {
    const db = new FakeDb();
    const j = journal(db);
    for (const id of ['a', 'b', 'c']) await j.record(op({ id }));
    expect(db.calls.map((c) => c.params[1])).toEqual(['2026-10-04T12:00:00.000000Z', '2026-10-04T12:00:00.000001Z', '2026-10-04T12:00:00.000002Z']);
  });

  it('markUndone and markSwept update the whole batch', async () => {
    const db = new FakeDb();
    const j = journal(db);
    await j.markUndone('batch-1');
    await j.markSwept('batch-2');
    expect(db.calls[0]).toMatchObject({ text: 'UPDATE file_ops SET undone = true WHERE batch_id = $1', params: ['batch-1'] });
    expect(db.calls[1]).toMatchObject({ text: 'UPDATE file_ops SET swept = true WHERE batch_id = $1', params: ['batch-2'] });
  });
});

describe('TigerFileOpsJournal reads', () => {
  it('lastBatch is the newest batch that is not undone and not swept', async () => {
    const db = new FakeDb();
    db.rows = [{ batch_id: 'batch-9' }];
    expect(await journal(db).lastBatch()).toBe('batch-9');
    expect(db.calls[0]!.text).toMatch(/undone = false AND coalesce\(swept, false\) = false AND op <> 'sweep'.*ORDER BY ts DESC LIMIT 1/s);
    db.rows = [];
    expect(await journal(db).lastBatch()).toBeNull();
  });

  it('batchOps maps rows back to FileOp, oldest first', async () => {
    const db = new FakeDb();
    db.rows = [
      { id: 'a', ts: new Date(NOW), job_id: 'job-1', op: 'mkdir', from_path: null, to_path: 'C:/x', batch_id: 'batch-1', undone: false, swept: false },
      { id: 'b', ts: new Date(NOW + 1), job_id: 'job-1', op: 'trash', from_path: 'C:/y', to_path: 'C:/ADE Trash/y', batch_id: 'batch-1', undone: true, swept: true }];
    expect(await journal(db).batchOps('batch-1')).toEqual([
      { id: 'a', ts: NOW, jobId: 'job-1', batchId: 'batch-1', op: 'mkdir', toPath: 'C:/x', undone: false },
      { id: 'b', ts: NOW + 1, jobId: 'job-1', batchId: 'batch-1', op: 'trash', fromPath: 'C:/y', toPath: 'C:/ADE Trash/y', undone: true, swept: true }]);
    expect(db.calls[0]!.text).toMatch(/WHERE batch_id = \$1 ORDER BY ts$/);
  });

  it('recent uses a cutoff; bad hours fall back to 24', async () => {
    const db = new FakeDb();
    await journal(db).recent(6);
    await journal(db).recent(NaN);
    expect(db.calls[0]!.params).toEqual([new Date(NOW - 6 * 3600 * 1000)]);
    expect(db.calls[1]!.params).toEqual([new Date(NOW - 24 * 3600 * 1000)]);
    expect(db.calls[0]!.text).toMatch(/ORDER BY ts DESC LIMIT 200/);
  });

  it('trashBatchesOlderThan finds unswept, not-undone trash batches past the cutoff', async () => {
    const db = new FakeDb();
    db.rows = [{ batch_id: 'old-1' }, { batch_id: 'old-2' }];
    expect(await journal(db).trashBatchesOlderThan(7)).toEqual(['old-1', 'old-2']);
    expect(db.calls[0]!.text).toMatch(/op = 'trash' AND undone = false AND coalesce\(swept, false\) = false.*HAVING max\(ts\) < \$1/s);
    expect(db.calls[0]!.params).toEqual([new Date(NOW - 7 * 24 * 3600 * 1000)]);
  });
});

describe('TigerFileOpsJournal never throws into the app', () => {
  it('every method survives a Tiger outage, and the log hides the connection string', async () => {
    const db = new FakeDb();
    db.down = true;
    const logs: string[] = [];
    const j = new TigerFileOpsJournal(db, () => NOW, (m) => logs.push(m));
    await expect(j.record(op())).resolves.toBeUndefined();
    await expect(j.markUndone('b')).resolves.toBeUndefined();
    await expect(j.markSwept('b')).resolves.toBeUndefined();
    expect(await j.lastBatch()).toBeNull();
    expect(await j.batchOps('b')).toEqual([]);
    expect(await j.recent(24)).toEqual([]);
    expect(await j.trashBatchesOlderThan(7)).toEqual([]);
    expect(logs).toHaveLength(7);
    expect(logs.join(' ')).not.toContain('secret');
  });
});

describe('biome_history agent_activity add-on', () => {
  it("counts file_ops for Archie's row and leaves the column off other rows", async () => {
    const db = new FakeDb();
    db.rows = [{ agent: 'beaver', jobs: 2, failed: 0, actions: 5, file_ops: 37 }, { agent: 'eagle', jobs: 1, failed: 0, actions: 3, file_ops: null }];
    const rows = await new TigerHistoryStore(db, () => NOW, quiet).query('agent_activity', 24);
    expect(db.calls[0]!.text).toMatch(/count\(\*\)::int AS file_ops FROM file_ops WHERE ts >= \$1/);
    expect(rows).toEqual([{ agent: 'beaver', jobs: 2, failed: 0, actions: 5, file_ops: 37 }, { agent: 'eagle', jobs: 1, failed: 0, actions: 3 }]);
  });
});
