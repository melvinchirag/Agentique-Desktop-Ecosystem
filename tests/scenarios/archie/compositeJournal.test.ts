import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createCompositeJournal } from '../../../src/main/connectors/fs/compositeJournal';
import { LocalFileOpsJournal } from '../../../src/main/connectors/fs/localJournal';
import type { FileOp, FileOpsJournal } from '../../../src/main/runtime/types';

const parents: string[] = [];
afterEach(async () => { for (const parent of parents.splice(0)) await rm(parent, { recursive: true, force: true }); });

it('local writes and reads survive Tiger rejection and a throwing logger without leaking driver errors', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ade-archie-journal-'));
  parents.push(parent);
  const local = new LocalFileOpsJournal(path.join(parent, 'file-ops.jsonl'));
  const providerDetail = 'TEST ONLY: synthetic Tiger provider detail';
  const logged: string[] = [];
  const tiger = {
    async record() { throw new Error(providerDetail); },
    async markUndone() { throw new Error(providerDetail); },
    async markSwept() { throw new Error(providerDetail); },
  } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger, (message) => { logged.push(message); throw new Error('logger failed'); });
  const op: FileOp = { id: 'one', ts: Date.now(), jobId: 'job', batchId: 'batch', op: 'move',
    fromPath: path.join(parent, 'from'), toPath: path.join(parent, 'to'), undone: false };
  await expect(journal.record(op)).resolves.toBeUndefined();
  await expect(journal.flush()).resolves.toBeUndefined();
  expect(await journal.lastBatch()).toBe('batch');
  expect(await journal.batchOps('batch')).toHaveLength(1);
  await expect(journal.markUndone('batch')).resolves.toBeUndefined();
  await expect(journal.markSwept('batch')).resolves.toBeUndefined();
  await expect(journal.flush()).resolves.toBeUndefined();
  expect(logged).toEqual(['Tiger copy of record failed', 'Tiger copy of markUndone failed', 'Tiger copy of markSwept failed']);
  expect(logged.join(' ')).not.toContain(providerDetail);
  expect((await journal.batchOps('batch'))[0]?.undone).toBe(true);
});

it('propagates a primary local write failure without scheduling a Tiger copy', async () => {
  let mirrored = false;
  const local = { async record() { throw new Error('local unavailable'); } } as unknown as FileOpsJournal;
  const tiger = { async record() { mirrored = true; } } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger);
  await expect(journal.record({} as FileOp)).rejects.toThrow('local unavailable');
  await journal.flush();
  expect(mirrored).toBe(false);
});

it('does not wait for a slow Tiger copy before returning from a local record', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ade-archie-journal-'));
  parents.push(parent);
  let release!: () => void;
  const tigerHeld = new Promise<void>((resolve) => { release = resolve; });
  const local = new LocalFileOpsJournal(path.join(parent, 'file-ops.jsonl'));
  const tiger = { async record() { await tigerHeld; } } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger);
  const op: FileOp = { id: 'one', ts: Date.now(), jobId: 'job', batchId: 'batch', op: 'move', undone: false };
  try {
    await journal.record(op);
    expect(await journal.lastBatch()).toBe('batch');
    let flushed = false;
    const flushing = journal.flush().then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(flushed).toBe(true);
  } finally { release(); }
});

it('mirrors successful local writes in order while the first Tiger write is pending', async () => {
  const localCalls: string[] = [];
  const tigerCalls: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const local = {
    async record(op: FileOp) { localCalls.push(`record:${op.id}`); },
    async markUndone(id: string) { localCalls.push(`undone:${id}`); },
    async markSwept(id: string) { localCalls.push(`swept:${id}`); },
  } as unknown as FileOpsJournal;
  const tiger = {
    async record(op: FileOp) { tigerCalls.push(`record:${op.id}`); if (op.id === 'first') await held; },
    async markUndone(id: string) { tigerCalls.push(`undone:${id}`); },
    async markSwept(id: string) { tigerCalls.push(`swept:${id}`); },
  } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger);
  const first = { id: 'first' } as FileOp;
  const second = { id: 'second' } as FileOp;
  try {
    await journal.record(first);
    await journal.record(second);
    await journal.markUndone('batch');
    await journal.markSwept('batch');
    expect(localCalls).toEqual(['record:first', 'record:second', 'undone:batch', 'swept:batch']);
    expect(tigerCalls).toEqual(['record:first']);
    release();
    await expect(journal.flush()).resolves.toBeUndefined();
    expect(tigerCalls).toEqual(['record:first', 'record:second', 'undone:batch', 'swept:batch']);
  } finally { release(); }
});

it('continues the Tiger queue after failures and a throwing logger, without exposing driver details', async () => {
  const providerDetail = 'TEST ONLY: synthetic Tiger provider detail';
  const mirrored: string[] = [];
  const messages: string[] = [];
  const local = {
    async record() {}, async markUndone() {}, async markSwept() {},
  } as unknown as FileOpsJournal;
  const tiger = {
    async record(op: FileOp) {
      mirrored.push(op.id);
      if (op.id === 'bad') throw new Error(providerDetail);
    },
    async markUndone() { mirrored.push('undone'); throw new Error(providerDetail); },
    async markSwept() { mirrored.push('swept'); },
  } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger, (message) => {
    messages.push(message);
    throw new Error('logger failed');
  });
  await journal.record({ id: 'bad' } as FileOp);
  await journal.record({ id: 'good' } as FileOp);
  await journal.markUndone('batch');
  await journal.markSwept('batch');
  await expect(journal.flush()).resolves.toBeUndefined();
  expect(mirrored).toEqual(['bad', 'good', 'undone', 'swept']);
  expect(messages).toEqual(['Tiger copy of record failed', 'Tiger copy of markUndone failed']);
  expect(messages.join(' ')).not.toContain(providerDetail);
});

it('propagates each local write failure and never mirrors that write', async () => {
  const mirrored: string[] = [];
  const local = {
    async record() { throw new Error('local record failed'); },
    async markUndone() { throw new Error('local undo failed'); },
    async markSwept() { throw new Error('local sweep failed'); },
  } as unknown as FileOpsJournal;
  const tiger = {
    async record() { mirrored.push('record'); },
    async markUndone() { mirrored.push('undone'); },
    async markSwept() { mirrored.push('swept'); },
  } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger);
  await expect(journal.record({} as FileOp)).rejects.toThrow('local record failed');
  await expect(journal.markUndone('batch')).rejects.toThrow('local undo failed');
  await expect(journal.markSwept('batch')).rejects.toThrow('local sweep failed');
  await expect(journal.flush()).resolves.toBeUndefined();
  expect(mirrored).toEqual([]);
});

it('routes every read to local even when a Tiger journal is present', async () => {
  const reads: string[] = [];
  const row = { id: 'local' } as FileOp;
  const local = {
    async lastBatch() { reads.push('lastBatch'); return 'local-batch'; },
    async batchOps(id: string) { reads.push(`batchOps:${id}`); return [row]; },
    async recent(hours: number) { reads.push(`recent:${hours}`); return [row]; },
    async trashBatchesOlderThan(days: number) { reads.push(`trash:${days}`); return ['old']; },
  } as unknown as FileOpsJournal;
  const tiger = {
    async lastBatch() { throw new Error('Tiger read attempted'); },
    async batchOps() { throw new Error('Tiger read attempted'); },
    async recent() { throw new Error('Tiger read attempted'); },
    async trashBatchesOlderThan() { throw new Error('Tiger read attempted'); },
  } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger);
  expect(await journal.lastBatch()).toBe('local-batch');
  expect(await journal.batchOps('local-batch')).toEqual([row]);
  expect(await journal.recent(24)).toEqual([row]);
  expect(await journal.trashBatchesOlderThan(7)).toEqual(['old']);
  expect(reads).toEqual(['lastBatch', 'batchOps:local-batch', 'recent:24', 'trash:7']);
});

it('works without Tiger and snapshots a record before its delayed mirror', async () => {
  const saved: FileOp[] = [];
  const local = {
    async record(op: FileOp) { saved.push({ ...op }); },
    async lastBatch() { return 'local'; },
  } as unknown as FileOpsJournal;
  const localOnly = createCompositeJournal(local);
  const row = { id: 'first', batchId: 'batch' } as FileOp;
  await localOnly.record(row);
  await expect(localOnly.flush()).resolves.toBeUndefined();
  expect(await localOnly.lastBatch()).toBe('local');

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const mirrored: FileOp[] = [];
  const tiger = {
    async record(op: FileOp) { if (op.id === 'first') await held; mirrored.push({ ...op }); },
  } as unknown as FileOpsJournal;
  const journal = createCompositeJournal(local, tiger);
  try {
    await journal.record(row);
    const mutable = { id: 'second', batchId: 'original' } as FileOp;
    await journal.record(mutable);
    mutable.batchId = 'changed-after-local-write';
    release();
    await journal.flush();
    expect(saved.at(-1)?.batchId).toBe('original');
    expect(mirrored[1]?.batchId).toBe('original');
  } finally { release(); }
});
