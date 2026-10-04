import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../src/main/runtime/clock';
import type { FileOp } from '../src/main/runtime/types';
import { makeSandbox } from './fixtures/makeSandbox';
import { LocalFileOpsJournal } from '../src/main/connectors/fs/localJournal';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ade-archie-f-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fileOp(batchId: string, id: string, ts: number, op: FileOp['op'] = 'move'): FileOp {
  return { id, ts, jobId: `job-${id}`, batchId, op, fromPath: `from/${id}`, toPath: `to/${id}`, undone: false };
}

describe('LocalFileOpsJournal', () => {
  it('persists appended operations and undo markers across journal instances', async () => {
    const clock = new FakeClock(1_800_000_000_000);
    const journalPath = path.join(await makeTempDir(), 'ADE', 'file-ops.jsonl');
    const first = new LocalFileOpsJournal(journalPath, { clock });
    await first.record(fileOp('batch-a', 'op-1', clock.now()));
    await first.record(fileOp('batch-a', 'op-2', clock.now() + 1, 'mkdir'));
    expect(await first.lastBatch()).toBe('batch-a');

    clock.advance(500);
    const restarted = new LocalFileOpsJournal(journalPath, { clock });
    expect(await restarted.batchOps('batch-a')).toHaveLength(2);
    await restarted.markUndone('batch-a');

    const afterUndo = new LocalFileOpsJournal(journalPath, { clock });
    expect(await afterUndo.lastBatch()).toBeNull();
    expect(await afterUndo.batchOps('batch-a')).toEqual([
      expect.objectContaining({ id: 'op-1', undone: true }),
      expect.objectContaining({ id: 'op-2', undone: true }),
    ]);
    const lines = (await readFile(journalPath, 'utf8')).trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'op-1', undone: false });
    expect(JSON.parse(lines[2])).toMatchObject({ kind: 'undone', batchId: 'batch-a' });
  });

  it('supports recency and selects only old, active trash batches for sweep', async () => {
    const clock = new FakeClock(1_800_000_000_000);
    const journalPath = path.join(await makeTempDir(), 'file-ops.jsonl');
    const journal = new LocalFileOpsJournal(journalPath, { clock });
    const oldTs = clock.now() - 8 * 24 * 60 * 60 * 1000;
    await journal.record(fileOp('old', 'trash-old', oldTs, 'trash'));
    await journal.record(fileOp('young', 'trash-young', clock.now() - 1_000, 'trash'));
    await journal.record(fileOp('undone', 'trash-undone', oldTs, 'trash'));
    await journal.record(fileOp('recent', 'move-recent', clock.now() - 30 * 60 * 1000));
    await journal.markUndone('undone');

    expect(await journal.recent(1)).toEqual([expect.objectContaining({ id: 'trash-young' }), expect.objectContaining({ id: 'move-recent' })]);
    expect(await journal.trashBatchesOlderThan(7)).toEqual(['old']);
    await journal.markSwept('old');

    const restarted = new LocalFileOpsJournal(journalPath, { clock });
    expect(await restarted.trashBatchesOlderThan(7)).toEqual([]);
    expect(await restarted.batchOps('old')).toEqual([
      expect.objectContaining({ id: 'trash-old', op: 'trash', swept: true }),
      expect.objectContaining({ op: 'sweep', swept: true }),
    ]);
  });

  it('treats a missing journal as empty, and skips unreadable lines instead of failing every read', async () => {
    const dir = await makeTempDir();
    const journalPath = path.join(dir, 'missing.jsonl');
    const journal = new LocalFileOpsJournal(journalPath);
    expect(await journal.lastBatch()).toBeNull();
    expect(await journal.recent(2)).toEqual([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(journalPath, '{bad json}\n'));
    expect(await journal.lastBatch()).toBeNull();                 // used to throw: one torn line made every batch un-undoable
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a torn last line (crash mid-append) loses only that row, and the next append starts on its own line', async () => {
    const dir = await makeTempDir();
    const journalPath = path.join(dir, 'torn.jsonl');
    const first = new LocalFileOpsJournal(journalPath);
    await first.record({ id: 'one', ts: 1, jobId: 'j', batchId: 'batch-1', op: 'move', fromPath: 'a', toPath: 'b', undone: false });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(journalPath, '{"id":"two","ts":2,"jobId":"j","batchId":"batch-2","op":"mov');   // power cut: no closing, no newline
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const restarted = new LocalFileOpsJournal(journalPath);
    expect(await restarted.lastBatch()).toBe('batch-1');          // the intact earlier batch is still undoable
    await restarted.record({ id: 'three', ts: 3, jobId: 'j', batchId: 'batch-3', op: 'move', fromPath: 'c', toPath: 'd', undone: false });
    expect(await restarted.lastBatch()).toBe('batch-3');          // the new row was not glued onto the torn line
    expect((await restarted.batchOps('batch-1')).map((op) => op.id)).toEqual(['one']);
    warn.mockRestore();
  });
});

describe('makeSandbox', () => {
  it('creates the documented isolated filesystem cases under its supplied parent', async () => {
    const parent = await makeTempDir();
    const fixture = await makeSandbox(parent, 1_800_000_000_000);
    expect(fixture.root).toBe(path.join(parent, 'sandbox'));
    expect(await stat(fixture.desktop)).toBeTruthy();
    expect(await stat(fixture.documents)).toBeTruthy();
    expect(await stat(fixture.adeTrash)).toBeTruthy();
    expect(await stat(fixture.executable)).toBeTruthy();
    expect(await stat(fixture.gitFolder)).toBeTruthy();
    expect(await stat(fixture.outsideSecret)).toBeTruthy();
    expect(await stat(fixture.freshFile).then((entry) => 1_800_000_000_000 - entry.mtimeMs)).toBeGreaterThanOrEqual(120_000);
    if (fixture.symlink) expect(await stat(fixture.symlink)).toBeTruthy();
  });
});
