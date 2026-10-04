import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../src/shared/tools';
import { EventBus } from '../src/main/bus/eventBus';
import { FileIndex } from '../src/main/connectors/fs/fileIndex';
import { LocalFileOpsJournal } from '../src/main/connectors/fs/localJournal';
import type { SafePathOptions } from '../src/main/connectors/fs/safePath';
import { createBeaverAgent } from '../src/main/agents/beaver';
import {
  clashName, createOrganizeToolBindings, dateFolder, moveWithoutOverwrite, sweepOldTrash, typeFolder,
} from '../src/main/agents/beaver/organizeTools';
import { PlanStore } from '../src/main/agents/beaver/planStore';
import { AgentRuntime } from '../src/main/runtime/agentRuntime';
import { FakeClock } from '../src/main/runtime/clock';
import type {
  ApprovalOutcome, Approvals, BiomeEventInput, FileOp, FileOpsJournal, JobScheduler, WardenGate,
} from '../src/main/runtime/types';
import { FakeFsShell } from '../src/main/testing/fakeFsShell';
import { FakeLlm, completed, requiresAction, toolCall } from '../src/main/testing/fakeLlm';
import { makeTestSettings } from '../src/main/testing/settings';
import { makeSandbox, type SandboxFixture } from './fixtures/makeSandbox';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Age every fixture file to `time` (except `keep`), so the 10-minute "in use" rule only hits the fresh file. */
async function ageTree(dir: string, time: number, keep: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await ageTree(full, time, keep);
    else if (!keep.includes(full)) await utimes(full, new Date(time), new Date(time));
  }
}

type Result = Record<string, any>;

interface Harness {
  fx: SandboxFixture;
  parent: string;
  clock: FakeClock;
  safe: SafePathOptions;
  index: FileIndex;
  journal: FileOpsJournal;
  journalPath: string;
  shell: FakeFsShell;
  tools: ReturnType<typeof createOrganizeToolBindings>;
  events: BiomeEventInput[];
  ctx: ToolContext;
  run(name: keyof ReturnType<typeof createOrganizeToolBindings>, input: unknown): Promise<Result>;
  restart(): void;
}

async function setup(options: { journal?: (inner: FileOpsJournal) => FileOpsJournal } = {}): Promise<Harness> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ade-archie-o-'));
  tempDirs.push(parent);
  const start = Date.now();
  const fx = await makeSandbox(parent, start);
  await ageTree(fx.root, start - DAY, [fx.freshFile]);
  const clock = new FakeClock(start);
  const safe: SafePathOptions = { allowedRoots: [fx.desktop, fx.documents, fx.downloads], documentsRoot: fx.documents };
  const index = new FileIndex({ ...safe, clock });
  await index.build();
  const journalPath = path.join(parent, 'appdata', 'ADE', 'file-ops.jsonl');
  const shell = new FakeFsShell();
  const events: BiomeEventInput[] = [];
  const ctx: ToolContext = {
    agentId: 'beaver', taskId: 'task-1', jobId: 'job-1', sessionId: 'session-1', threadId: 'thread-1',
    emit: (event) => events.push(event), signal: new AbortController().signal,
  };
  const h = { fx, parent, clock, safe, index, journalPath, shell, events, ctx } as Harness;
  h.restart = () => {
    const local = new LocalFileOpsJournal(journalPath, { clock });
    h.journal = options.journal ? options.journal(local) : local;
    h.tools = createOrganizeToolBindings({ safe, index, journal: h.journal, shell, clock });
  };
  h.run = (name, input) => h.tools[name].execute(input, ctx) as Promise<Result>;
  h.restart();
  return h;
}

const downloadsFile = (h: Harness, name: string) => path.join(h.fx.downloads, name);
const statuses = (h: Harness) => h.events.flatMap((e) => (e.type === 'agent.status' && e.detail ? [e.detail] : []));

async function trashLeftovers(h: Harness): Promise<string[]> {
  return readdir(h.fx.adeTrash);
}

describe('helpers', () => {
  it('maps types, dates and clash names', () => {
    expect(typeFolder('a.PDF')).toBe('PDFs');
    expect(typeFolder('setup.exe')).toBe('Installers');
    expect(typeFolder('x.unknown')).toBe('Other');
    expect(dateFolder(new Date(2026, 9, 4, 12).getTime())).toBe(path.join('2026', '10 - October'));
    expect(clashName(path.join('d', 'report.pdf'), 2)).toBe(path.join('d', 'report (2).pdf'));
    expect(clashName(path.join('d', 'README'), 3)).toBe(path.join('d', 'README (3)'));
  });

  it('PlanStore expires plans after 30 minutes and never hands a plan out twice', () => {
    const clock = new FakeClock(1_000);
    const store = new PlanStore(clock);
    store.put({ planId: 'p1', title: 't', moves: [], skipped: [], folders: [], newFolderCount: 0 });
    store.put({ planId: 'p2', title: 't', moves: [], skipped: [], folders: [], newFolderCount: 0 });
    clock.advance(30 * MINUTE - 1);
    expect(store.get('p1').ok).toBe(true);
    expect(store.take('p2').ok).toBe(true);
    expect(store.take('p2')).toEqual({ ok: false, error: 'PLAN_ALREADY_APPLIED' });
    clock.advance(1);
    expect(store.get('p1')).toEqual({ ok: false, error: 'PLAN_EXPIRED' });
    expect(store.get('nope')).toEqual({ ok: false, error: 'PLAN_NOT_FOUND' });
    expect(store.get(42)).toEqual({ ok: false, error: 'PLAN_NOT_FOUND' });
  });
});

describe('moveWithoutOverwrite', () => {
  it('never overwrites: a taken destination gets a clash name, or is skipped', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ade-archie-o-move-'));
    tempDirs.push(dir);
    await writeFile(path.join(dir, 'a.txt'), 'source');
    await writeFile(path.join(dir, 'b.txt'), 'keep me');
    const journaled: string[] = [];
    const skipped = await moveWithoutOverwrite(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'), {
      onClash: 'skip', beforeMove: async (to) => { journaled.push(to); },
    });
    expect(skipped).toEqual({ ok: false, error: 'TARGET_TAKEN' });
    expect(journaled).toEqual([]);
    const moved = await moveWithoutOverwrite(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'), {
      onClash: 'number', beforeMove: async (to) => { journaled.push(to); },
    });
    expect(moved).toEqual({ ok: true, to: path.join(dir, 'b (2).txt') });
    expect(journaled).toEqual([path.join(dir, 'b (2).txt')]);
    expect(await readFile(path.join(dir, 'b.txt'), 'utf8')).toBe('keep me');
    expect(await readFile(path.join(dir, 'b (2).txt'), 'utf8')).toBe('source');
  });

  it('does not move when the journal write fails, and removes its placeholder', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ade-archie-o-move-'));
    tempDirs.push(dir);
    await writeFile(path.join(dir, 'a.txt'), 'source');
    const result = await moveWithoutOverwrite(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'), {
      onClash: 'number', beforeMove: async () => { throw new Error('disk full'); },
    });
    expect(result).toEqual({ ok: false, error: 'JOURNAL_FAILED' });
    expect(await readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('source');
    expect(existsSync(path.join(dir, 'b.txt'))).toBe(false);
  });

  it('cross-volume: copies, verifies, keeps the modified date, then removes the source', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ade-archie-o-move-'));
    tempDirs.push(dir);
    const from = path.join(dir, 'big.bin');
    await writeFile(from, Buffer.alloc(200_000, 7));
    const old = new Date(2025, 0, 2);
    await utimes(from, old, old);
    const io = { rename: vi.fn(async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); }) };
    const result = await moveWithoutOverwrite(from, path.join(dir, 'moved.bin'), { onClash: 'number', beforeMove: async () => undefined, io });
    expect(result).toEqual({ ok: true, to: path.join(dir, 'moved.bin') });
    expect(io.rename).toHaveBeenCalledOnce();
    expect(existsSync(from)).toBe(false);
    const copy = await stat(path.join(dir, 'moved.bin'));
    expect(copy.size).toBe(200_000);
    expect(Math.abs(copy.mtimeMs - old.getTime())).toBeLessThan(2_000);
  });
});

describe('A5 — clean up my Downloads (fs_plan_organize by_type → one fs_apply_plan)', () => {
  it('plans without side effects, then applies with journal + throttled progress; .git, fresh file and links are skipped', async () => {
    const h = await setup();
    const before = (await readdir(h.fx.downloads)).sort();
    const plan = await h.run('fs_plan_organize', { path: 'Downloads', strategy: 'by_type' });
    expect((await readdir(h.fx.downloads)).sort()).toEqual(before);           // no side effects
    expect(existsSync(h.journalPath)).toBe(false);
    expect(plan.plan_id).toEqual(expect.any(String));
    expect(plan.moves).toBe(61);                                                // 60 fixtures + setup.exe
    expect(plan.folders).toEqual(expect.arrayContaining(['Downloads/PDFs', 'Downloads/Images', 'Downloads/Installers', 'Downloads/Code']));
    const reasons = Object.fromEntries((plan.skipped as { path: string; reason: string }[]).map((s) => [s.path, s.reason]));
    expect(reasons['Downloads/fresh-file.txt']).toMatch(/10 minutes/);
    expect(reasons['Downloads/.git']).toMatch(/hidden or system/);
    if (h.fx.symlink) expect(reasons['Downloads/outside-link.txt']).toMatch(/link/);
    const artifact = h.events.find((e) => e.type === 'artifact');
    expect(artifact).toMatchObject({ kind: 'file_plan', agentId: 'beaver', taskId: 'task-1', data: { counts: { moves: 61 } } });
    expect((artifact as { data: { sample: unknown[] } }).data.sample).toHaveLength(10);
    expect(statuses(h)).toContain(`Plan: 61 files → ${plan.folders.length} folders`);

    expect(h.tools.fs_apply_plan.preview!({ plan_id: plan.plan_id }))
      .toBe(`Move 61 files into ${plan.folders.length} new folders in Downloads (undo anytime)`);
    expect(h.tools.fs_apply_plan.riskFor!({ plan_id: plan.plan_id })).toBe('write');

    h.events.length = 0;
    const applied = await h.run('fs_apply_plan', { plan_id: plan.plan_id });
    expect(applied).toMatchObject({ ok: true, moved: 61, failed: [] });
    expect(existsSync(path.join(h.fx.downloads, 'Installers', 'setup.exe'))).toBe(true);   // moved, never opened
    expect(existsSync(path.join(h.fx.downloads, 'PDFs', 'fixture-01.pdf'))).toBe(true);
    expect(existsSync(h.fx.freshFile)).toBe(true);
    expect(existsSync(path.join(h.fx.gitFolder, 'config'))).toBe(true);
    expect(h.shell.opened).toEqual([]);
    expect(h.shell.trashed).toEqual([]);
    expect(statuses(h)).toEqual(['0/61', '10/61', '20/61', '30/61', '40/61', '50/61', '60/61', '61/61'].map((p) => `Building the dam… ${p}`));

    const ops = await h.journal.batchOps(applied.batch_id);
    expect(ops.filter((op) => op.op === 'mkdir')).toHaveLength(plan.folders.length);
    expect(ops.filter((op) => op.op === 'move')).toHaveLength(61);
    expect(ops.every((op) => op.jobId === 'job-1' && !op.undone)).toBe(true);
    expect(h.index.search('fixture-01').map((e) => e.path)).toEqual([expect.stringContaining(`${path.sep}PDFs${path.sep}`)]);
    expect(await h.run('fs_apply_plan', { plan_id: plan.plan_id })).toEqual({ error: 'PLAN_ALREADY_APPLIED' });
  });

  it('by_date uses the modified month; include_subfolders skips git repos and files already in place', async () => {
    const h = await setup();
    const repo = path.join(h.fx.downloads, 'project');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await writeFile(path.join(repo, 'main.ts'), 'code');
    const folderName = dateFolder(h.clock.now() - DAY);
    const tidy = path.join(h.fx.downloads, folderName);
    await mkdir(tidy, { recursive: true });
    await writeFile(path.join(tidy, 'already.txt'), 'x');
    await ageTree(h.fx.downloads, h.clock.now() - DAY, [h.fx.freshFile]);
    const plan = await h.run('fs_plan_organize', { path: 'Downloads', strategy: 'by_date', include_subfolders: true });
    expect(plan.folders).toEqual([`Downloads/${folderName.split(path.sep).join('/')}`]);
    expect(plan.moves).toBe(61);
    expect(plan.already_in_place).toBe(1);
    expect(plan.skipped).toContainEqual({ path: 'Downloads/project', reason: 'git repository (left alone)' });
  });

  it('rejects bad input and the trash folder; expires plans after 30 minutes', async () => {
    const h = await setup();
    expect(await h.run('fs_plan_organize', { path: 'Downloads', strategy: 'by_course' })).toMatchObject({ error: 'INVALID_STRATEGY' });
    expect(await h.run('fs_plan_organize', { path: h.fx.outsidePrefix, strategy: 'by_type' })).toMatchObject({ error: 'OUTSIDE_ALLOWED_FOLDERS', allowed: ['Desktop', 'Documents', 'Downloads'] });
    expect(await h.run('fs_plan_organize', { path: 'Documents/ADE Trash', strategy: 'by_type' })).toMatchObject({ error: 'ADE_TRASH_PROTECTED' });
    expect(await h.run('fs_plan_organize', { path: 'Desktop/notes.txt', strategy: 'by_type' })).toMatchObject({ error: 'NOT_A_FOLDER' });
    const plan = await h.run('fs_plan_organize', { path: 'Desktop', strategy: 'by_type' });
    h.clock.advance(30 * MINUTE);
    expect(h.tools.fs_apply_plan.preview!({ plan_id: plan.plan_id })).toMatch(/PLAN_EXPIRED, nothing will move/);
    expect(await h.run('fs_apply_plan', { plan_id: plan.plan_id })).toMatchObject({ error: 'PLAN_EXPIRED' });
    expect(await h.run('fs_apply_plan', { plan_id: 'made-up' })).toEqual({ error: 'PLAN_NOT_FOUND' });
    expect(existsSync(path.join(h.fx.desktop, 'notes.txt'))).toBe(true);
  });
});

describe('A6 — sort by course (fs_propose_plan → one apply)', () => {
  it('validates every move and applies the checked plan', async () => {
    const h = await setup();
    const plan = await h.run('fs_propose_plan', {
      title: 'Sort Downloads by course',
      moves: [
        { from: 'Downloads/fixture-01.pdf', to_folder: 'Documents/EMU/CS 280' },
        { from: 'Downloads/fixture-04.txt', to_folder: 'Documents/EMU/CS 280' },
        { from: 'Downloads/fixture-11.pdf', to_folder: 'Documents/EMU/MATH 120' },
        { from: 'Downloads/fixture-01.pdf', to_folder: 'Documents/EMU/MATH 120' },          // listed twice
        { from: h.fx.outsideSecret, to_folder: 'Documents/EMU' },                            // outside
        { from: 'Downloads/fixture-02.png', to_folder: h.fx.outsidePrefix },                 // destination outside
        { from: 'Downloads/fixture-03.jpg', to_folder: 'Documents/ADE Trash' },              // into trash
        { from: 'Downloads/fixture-05.docx', to_folder: 'Downloads' },                       // into itself
        { from: 'Downloads/nope.pdf', to_folder: 'Documents' },                              // missing
        { from: 'Downloads/fresh-file.txt', to_folder: 'Documents' },                        // in use
        { from: 'Downloads/.git/config', to_folder: 'Documents' },                           // excluded
      ],
    });
    expect(plan.moves).toBe(3);
    expect(plan.folders).toEqual(['Documents/EMU/CS 280', 'Documents/EMU/MATH 120']);
    expect(plan.skipped.map((s: { reason: string }) => s.reason)).toEqual([
      'listed twice', 'OUTSIDE_ALLOWED_FOLDERS', 'destination OUTSIDE_ALLOWED_FOLDERS',
      'destination is ADE Trash (use fs_trash to delete)', 'already in that folder', 'not found',
      'changed in the last 10 minutes (probably in use)', 'EXCLUDED_PATH',
    ]);
    expect(h.tools.fs_apply_plan.preview!({ plan_id: plan.plan_id }))
      .toBe('Move 3 files into 2 new folders in Documents (undo anytime): fixture-01.pdf, fixture-04.txt, fixture-11.pdf');
    const applied = await h.run('fs_apply_plan', { plan_id: plan.plan_id });
    expect(applied).toMatchObject({ ok: true, moved: 3, folders_created: 3 });   // EMU, CS 280, MATH 120
    expect(existsSync(path.join(h.fx.documents, 'EMU', 'CS 280', 'fixture-04.txt'))).toBe(true);
    expect(existsSync(path.join(h.fx.documents, 'EMU', 'MATH 120', 'fixture-11.pdf'))).toBe(true);
  });

  it('rejects malformed and oversized proposals; an all-skipped proposal stores no plan', async () => {
    const h = await setup();
    expect(await h.run('fs_propose_plan', { moves: [] })).toMatchObject({ error: 'INVALID_ARGUMENTS' });
    const many = Array.from({ length: 501 }, () => ({ from: 'Downloads/a', to_folder: 'Documents' }));
    expect(await h.run('fs_propose_plan', { title: 't', moves: many })).toMatchObject({ error: 'TOO_MANY_MOVES' });
    const empty = await h.run('fs_propose_plan', { title: 't', moves: [{ from: 'Downloads/missing.pdf', to_folder: 'Documents' }] });
    expect(empty).toMatchObject({ plan_id: null, moves: 0, summary: 'Nothing to move.' });
    expect(h.events.some((e) => e.type === 'artifact')).toBe(false);
  });
});

describe('A7 + A8 — undo (also after a restart)', () => {
  it('puts files back, removes the empty folders it created, marks the batch undone', async () => {
    const h = await setup();
    const before = (await readdir(h.fx.downloads)).sort();
    const plan = await h.run('fs_plan_organize', { path: 'Downloads', strategy: 'by_type' });
    const applied = await h.run('fs_apply_plan', { plan_id: plan.plan_id });
    expect(applied.moved).toBe(61);
    expect(h.tools.fs_undo.preview!({})).toBe("Undo: put Archie's last change back");

    const undo = await h.run('fs_undo', {});
    expect(undo).toMatchObject({ ok: true, batch_id: applied.batch_id, restored: 61, folders_removed: plan.folders.length, skipped: [] });
    expect((await readdir(h.fx.downloads)).sort()).toEqual(before);
    expect(await h.journal.lastBatch()).toBeNull();
    expect((await h.journal.batchOps(applied.batch_id)).every((op) => op.undone)).toBe(true);
    expect(await h.run('fs_undo', { batch_id: applied.batch_id })).toEqual({ error: 'ALREADY_UNDONE', batch_id: applied.batch_id });
    expect(await h.run('fs_undo', {})).toEqual({ error: 'NOTHING_TO_UNDO' });
    expect(h.index.search('fixture-01').map((e) => path.dirname(e.path))).toEqual([expect.stringMatching(/Downloads$/)]);
  });

  it('A8: a fresh journal + tool instance (restart) still undoes the batch', async () => {
    const h = await setup();
    const moved = await h.run('fs_move', { from: 'Documents/resume.pdf', to_folder: 'Documents/Jobs/2026' });
    expect(moved).toMatchObject({ ok: true, to: 'Documents/Jobs/2026/resume.pdf', folders_created: 2 });
    h.restart();
    const undo = await h.run('fs_undo', {});
    expect(undo).toMatchObject({ ok: true, restored: 1, folders_removed: 2 });
    expect(existsSync(path.join(h.fx.documents, 'resume.pdf'))).toBe(true);
    expect(existsSync(path.join(h.fx.documents, 'Jobs'))).toBe(false);
  });

  it('partial undo: a re-taken original spot is skipped, a non-empty created folder is kept', async () => {
    const h = await setup();
    const plan = await h.run('fs_propose_plan', { title: 't', moves: [
      { from: 'Downloads/fixture-01.pdf', to_folder: 'Downloads/School' },
      { from: 'Downloads/fixture-11.pdf', to_folder: 'Downloads/School' },
    ] });
    await h.run('fs_apply_plan', { plan_id: plan.plan_id });
    await writeFile(downloadsFile(h, 'fixture-01.pdf'), 'new file the user made');
    await writeFile(path.join(h.fx.downloads, 'School', 'user-added.txt'), 'mine');
    const undo = await h.run('fs_undo', {});
    expect(undo).toMatchObject({ ok: true, restored: 1, folders_removed: 0, folders_kept: ['Downloads/School'] });
    expect(undo.skipped).toEqual([{ path: 'Downloads/fixture-01.pdf', reason: 'original spot is taken' }]);
    expect(await readFile(downloadsFile(h, 'fixture-01.pdf'), 'utf8')).toBe('new file the user made');
    expect(existsSync(path.join(h.fx.downloads, 'School', 'fixture-01.pdf'))).toBe(true);
    expect(existsSync(downloadsFile(h, 'fixture-11.pdf'))).toBe(true);
  });

  it('a journaled op that never ran (crash between journal and move) is skipped safely', async () => {
    const h = await setup();
    const from = downloadsFile(h, 'fixture-01.pdf');
    await h.journal.record({ id: 'op-1', ts: h.clock.now(), jobId: 'job-0', batchId: 'crashed', op: 'move',
      fromPath: from, toPath: path.join(h.fx.downloads, 'PDFs', 'fixture-01.pdf'), undone: false });
    const undo = await h.run('fs_undo', {});
    expect(undo).toMatchObject({ ok: true, batch_id: 'crashed', restored: 0 });
    expect(undo.skipped[0].reason).toBe('no longer there');
    expect(await readFile(from, 'utf8')).toBe('fixture 1\n');
  });

  it('never follows a tampered journal outside the sandbox or into path tricks', async () => {
    const h = await setup();
    await h.journal.record({ id: 'op-1', ts: h.clock.now(), jobId: 'job-0', batchId: 'evil', op: 'move',
      fromPath: h.fx.outsideSecret, toPath: downloadsFile(h, 'fixture-01.pdf'), undone: false });
    await h.journal.record({ id: 'op-2', ts: h.clock.now(), jobId: 'job-0', batchId: 'evil', op: 'mkdir',
      toPath: h.fx.downloads, undone: false });
    const undo = await h.run('fs_undo', { batch_id: 'evil' });
    expect(undo.restored).toBe(0);
    expect(undo.skipped.map((s: { reason: string }) => s.reason)).toEqual(['folder outside allowed folders', 'outside allowed folders']);
    expect(existsSync(downloadsFile(h, 'fixture-01.pdf'))).toBe(true);
    expect(existsSync(h.fx.downloads)).toBe(true);
    expect(await h.run('fs_undo', { batch_id: '../../Downloads' })).toMatchObject({ error: 'INVALID_BATCH_ID' });
    expect(await h.run('fs_undo', { batch_id: 'never-existed' })).toMatchObject({ error: 'UNKNOWN_BATCH' });
  });
});

describe('A9 — name clashes', () => {
  it('plans and applies clash names; nothing is ever overwritten', async () => {
    const h = await setup();
    await mkdir(path.join(h.fx.downloads, 'PDFs'));
    await writeFile(path.join(h.fx.downloads, 'PDFs', 'fixture-01.pdf'), 'already there');
    const plan = await h.run('fs_plan_organize', { path: 'Downloads', strategy: 'by_type' });
    expect(plan.sample).toContainEqual({ from: 'Downloads/fixture-01.pdf', to: 'Downloads/PDFs/fixture-01 (2).pdf' });
    // A file appears at a planned destination between planning and applying.
    await writeFile(path.join(h.fx.downloads, 'PDFs', 'fixture-11.pdf'), 'sneaked in');
    const applied = await h.run('fs_apply_plan', { plan_id: plan.plan_id });
    expect(applied).toMatchObject({ ok: true, moved: 61, failed: [] });
    expect(await readFile(path.join(h.fx.downloads, 'PDFs', 'fixture-01.pdf'), 'utf8')).toBe('already there');
    expect(await readFile(path.join(h.fx.downloads, 'PDFs', 'fixture-01 (2).pdf'), 'utf8')).toBe('fixture 1\n');
    expect(await readFile(path.join(h.fx.downloads, 'PDFs', 'fixture-11.pdf'), 'utf8')).toBe('sneaked in');
    expect(await readFile(path.join(h.fx.downloads, 'PDFs', 'fixture-11 (2).pdf'), 'utf8')).toBe('fixture 11\n');
    const undo = await h.run('fs_undo', {});
    expect(undo.restored).toBe(61);
    expect(await readdir(path.join(h.fx.downloads, 'PDFs'))).toEqual(['fixture-01.pdf', 'fixture-11.pdf']);   // the user's files stay
  });

  it('skips a file that changed after planning', async () => {
    const h = await setup();
    const plan = await h.run('fs_propose_plan', { title: 't', moves: [{ from: 'Downloads/fixture-01.pdf', to_folder: 'Downloads/x' }] });
    await writeFile(downloadsFile(h, 'fixture-01.pdf'), 'edited');
    const applied = await h.run('fs_apply_plan', { plan_id: plan.plan_id });
    expect(applied).toMatchObject({ moved: 0, skipped: [{ path: 'Downloads/fixture-01.pdf', reason: 'changed since the plan' }] });
    expect(await readFile(downloadsFile(h, 'fixture-01.pdf'), 'utf8')).toBe('edited');
  });
});

describe('A10 + A17 — soft trash and undo', () => {
  it('moves the file into ADE Trash/<batch>/, journals trash first, then undo restores it and removes the batch folder', async () => {
    const h = await setup();
    const oldNotes = path.join(h.fx.desktop, 'old-notes.txt');
    await writeFile(oldNotes, 'old notes');
    expect(h.tools.fs_trash.preview!({ paths: ['Desktop/old-notes.txt'] }))
      .toBe('Move 1 file to ADE Trash: old-notes.txt (undo anytime; emptied to the Recycle Bin after 7 days)');
    expect(h.tools.fs_trash.riskFor!({ paths: ['Desktop/old-notes.txt'] })).toBe('destructive');

    const trashed = await h.run('fs_trash', { paths: ['Desktop/old-notes.txt'] });
    expect(trashed).toMatchObject({ ok: true, trashed: 1, files: ['Desktop/old-notes.txt'], failed: [] });
    expect(trashed.message).toMatch(/Say undo to bring it back/);
    expect(statuses(h)).toContain('Hauling 1 files to ADE Trash…');
    const inTrash = path.join(h.fx.adeTrash, trashed.batch_id, 'Desktop', 'old-notes.txt');
    expect(await readFile(inTrash, 'utf8')).toBe('old notes');
    expect(existsSync(oldNotes)).toBe(false);
    expect(h.shell.trashed).toEqual([]);                                     // never the Recycle Bin directly
    const ops = await h.journal.batchOps(trashed.batch_id);
    expect(ops).toEqual([expect.objectContaining({ op: 'trash', fromPath: expect.stringMatching(/old-notes\.txt$/), toPath: expect.stringContaining('ADE Trash') })]);

    const undo = await h.run('fs_undo', {});
    expect(undo).toMatchObject({ ok: true, batch_id: trashed.batch_id, restored: 1 });
    expect(await readFile(oldNotes, 'utf8')).toBe('old notes');
    expect(await trashLeftovers(h)).toEqual([]);
    expect((await h.journal.batchOps(trashed.batch_id))[0]!.undone).toBe(true);
  });

  it('trash undo onto a re-used name restores as name (2); folders keep structure', async () => {
    const h = await setup();
    const sub = path.join(h.fx.downloads, 'old');
    await mkdir(sub);
    await writeFile(path.join(sub, 'a.txt'), 'first');
    const trashed = await h.run('fs_trash', { paths: ['Downloads/old/a.txt', 'Downloads/fixture-01.pdf'] });
    expect(trashed.trashed).toBe(2);
    expect(existsSync(path.join(h.fx.adeTrash, trashed.batch_id, 'Downloads', 'old', 'a.txt'))).toBe(true);
    await writeFile(path.join(sub, 'a.txt'), 'second');
    const undo = await h.run('fs_undo', { batch_id: trashed.batch_id });
    expect(undo).toMatchObject({ restored: 2, restored_under_new_name: ['Downloads/old/a (2).txt'], skipped: [] });
    expect(await readFile(path.join(sub, 'a.txt'), 'utf8')).toBe('second');
    expect(await readFile(path.join(sub, 'a (2).txt'), 'utf8')).toBe('first');
    expect(await trashLeftovers(h)).toEqual([]);
  });

  it('refuses folders, trash contents, outside paths; an all-failed call leaves no batch', async () => {
    const h = await setup();
    const result = await h.run('fs_trash', { paths: ['Downloads', 'Documents/ADE Trash', h.fx.outsideSecret, 'Downloads/missing.txt', 'Downloads/.git/config'] });
    expect(result).toMatchObject({ ok: false, trashed: 0 });
    expect(result.failed.map((f: { error: string }) => f.error)).toEqual(['NOT_A_FILE', 'ALREADY_IN_ADE_TRASH', 'OUTSIDE_ALLOWED_FOLDERS', 'NOT_FOUND', 'EXCLUDED_PATH']);
    expect(await trashLeftovers(h)).toEqual([]);
    expect(await h.journal.lastBatch()).toBeNull();
    expect(await h.run('fs_trash', { paths: [] })).toMatchObject({ error: 'INVALID_ARGUMENTS' });
    expect(await h.run('fs_trash', { paths: Array.from({ length: 51 }, () => 'Downloads/x') })).toMatchObject({ error: 'TOO_MANY_FILES' });
    expect(h.tools.fs_trash.preview!({ paths: Array.from({ length: 30 }, (_, i) => `Downloads/f${i}.txt`) }))
      .toBe('Move 30 files to ADE Trash from Downloads (undo anytime; emptied to the Recycle Bin after 7 days)');
  });
});

describe('A18 — seven-day sweep', () => {
  it('sends only batches older than 7 days to the Recycle Bin via FsShell; undo then says ALREADY_IN_RECYCLE_BIN', async () => {
    const h = await setup();
    const old = await h.run('fs_trash', { paths: ['Downloads/fixture-01.pdf'] });
    h.clock.advance(2 * DAY);
    const young = await h.run('fs_trash', { paths: ['Downloads/fixture-02.png'] });
    h.clock.advance(5 * DAY + MINUTE);                                         // old: 7 d + 1 min; young: 5 d + 1 min
    h.restart();
    const emitted: BiomeEventInput[] = [];
    const result = await sweepOldTrash({ safe: h.safe, journal: h.journal, shell: h.shell, emit: (e) => emitted.push(e) });
    expect(result).toEqual({ swept: [old.batch_id], failed: [] });
    expect(h.shell.trashed).toEqual([path.join(await realDir(h.fx.adeTrash), old.batch_id)]);
    expect(emitted.map((e) => e.type === 'agent.status' && e.status)).toEqual(['working', 'idle']);
    const ops = await h.journal.batchOps(old.batch_id);
    expect(ops.map((op) => op.op)).toEqual(['trash', 'sweep']);
    expect(ops.every((op) => op.swept)).toBe(true);
    expect(await h.run('fs_undo', { batch_id: old.batch_id })).toEqual({
      error: 'ALREADY_IN_RECYCLE_BIN', batch_id: old.batch_id, message: "That one's in your Recycle Bin now. Right-click → Restore.",
    });
    expect(existsSync(path.join(h.fx.adeTrash, young.batch_id))).toBe(true);
    expect(await sweepOldTrash({ safe: h.safe, journal: h.journal, shell: h.shell })).toEqual({ swept: [], failed: [] });
    expect((await h.run('fs_undo', { batch_id: young.batch_id })).restored).toBe(1);
  });

  it('a failing trashItem leaves the batch in ADE Trash, undoable, and retried next sweep', async () => {
    const h = await setup();
    const old = await h.run('fs_trash', { paths: ['Downloads/fixture-01.pdf'] });
    h.clock.advance(7 * DAY + MINUTE);
    h.shell.failTrash = 'file is locked';
    expect(await sweepOldTrash({ safe: h.safe, journal: h.journal, shell: h.shell })).toEqual({ swept: [], failed: [{ batchId: old.batch_id, error: 'file is locked' }] });
    expect((await h.journal.batchOps(old.batch_id)).some((op) => op.swept)).toBe(false);
    h.shell.failTrash = undefined;
    expect((await sweepOldTrash({ safe: h.safe, journal: h.journal, shell: h.shell })).swept).toEqual([old.batch_id]);
  });

  it('never trashes outside ADE Trash, whatever the journal says', async () => {
    const h = await setup();
    const evil: FileOpsJournal = {
      record: async () => undefined, lastBatch: async () => null, markUndone: async () => undefined, recent: async () => [],
      markSwept: vi.fn(async () => undefined),
      trashBatchesOlderThan: async () => ['..', '../..', 'ok-batch'],
      batchOps: async () => [{ id: 'x', ts: 0, jobId: 'j', batchId: 'ok-batch', op: 'trash', fromPath: 'a', toPath: h.fx.downloads, undone: false } satisfies FileOp],
    };
    const result = await sweepOldTrash({ safe: h.safe, journal: evil, shell: h.shell });
    expect(result.failed).toEqual([
      { batchId: '..', error: 'INVALID_BATCH_ID' }, { batchId: '../..', error: 'INVALID_BATCH_ID' }, { batchId: 'ok-batch', error: 'TRASH_LOCATION_CHANGED' },
    ]);
    expect(h.shell.trashed).toEqual([]);
    expect(evil.markSwept).not.toHaveBeenCalled();
  });
});

describe('A19 — ADE Trash is never planned', () => {
  it('fs_plan_organize over Documents (with subfolders) ignores ADE Trash entirely', async () => {
    const h = await setup();
    await h.run('fs_trash', { paths: ['Downloads/fixture-01.pdf', 'Desktop/notes.txt'] });
    await ageTree(h.fx.adeTrash, h.clock.now() - DAY, []);
    h.events.length = 0;
    const plan = await h.run('fs_plan_organize', { path: 'Documents', strategy: 'by_type', include_subfolders: true });
    expect(plan.moves).toBe(1);                                                  // resume.pdf only
    expect(JSON.stringify(plan)).not.toContain('ADE Trash');
    expect(JSON.stringify(h.events)).not.toContain('ADE Trash');
  });
});

describe('single changes (fs_move, fs_rename, fs_mkdir)', () => {
  it('moves one file, refusing trash, outside paths, folders and no-op moves', async () => {
    const h = await setup();
    expect(h.tools.fs_move.preview!({ from: 'Documents/resume.pdf', to_folder: 'Documents/Jobs' })).toBe('Move resume.pdf → Documents/Jobs');
    expect(await h.run('fs_move', { from: 'Documents/resume.pdf', to_folder: 'Documents' })).toMatchObject({ error: 'ALREADY_THERE' });
    expect(await h.run('fs_move', { from: 'Documents/resume.pdf', to_folder: 'Documents/ADE Trash' })).toMatchObject({ error: 'ADE_TRASH_PROTECTED' });
    expect(await h.run('fs_move', { from: 'Documents/resume.pdf', to_folder: h.fx.outsidePrefix })).toMatchObject({ error: 'OUTSIDE_ALLOWED_FOLDERS' });
    expect(await h.run('fs_move', { from: 'Downloads', to_folder: 'Documents' })).toMatchObject({ error: 'NOT_A_FILE' });
    expect(await h.run('fs_move', { from: 'Desktop/notes.txt', to_folder: 'Desktop/notes.txt' })).toMatchObject({ error: 'NOT_A_FOLDER' });
    const missing = await h.run('fs_move', { from: 'Downloads/fixture-01', to_folder: 'Documents' });
    expect(missing).toMatchObject({ error: 'NOT_FOUND' });
    expect(missing.suggestions[0]).toMatch(/^Downloads\/fixture-01/);
    expect(existsSync(path.join(h.fx.documents, 'resume.pdf'))).toBe(true);
    expect(existsSync(h.journalPath)).toBe(false);
  });

  it('renames with clash names and case-only changes; undo reverses renames; roots are protected', async () => {
    const h = await setup();
    expect(h.tools.fs_rename.preview!({ path: 'Downloads/fixture-02.png', new_name: 'beach-day.png' })).toBe('Rename fixture-02.png → beach-day.png');
    const first = await h.run('fs_rename', { path: 'Downloads/fixture-02.png', new_name: 'fixture-12.png' });
    expect(first).toMatchObject({ ok: true, to: 'Downloads/fixture-12 (2).png', renamed_to_avoid_clash: true });
    const caseOnly = await h.run('fs_rename', { path: 'Downloads/fixture-03.jpg', new_name: 'FIXTURE-03.jpg' });
    expect(caseOnly).toMatchObject({ ok: true, to: 'Downloads/FIXTURE-03.jpg' });
    expect(await readdir(h.fx.downloads)).toContain('FIXTURE-03.jpg');
    const folder = path.join(h.fx.downloads, 'Old Stuff');
    await mkdir(folder);
    expect(await h.run('fs_rename', { path: 'Downloads/Old Stuff', new_name: 'Archive' })).toMatchObject({ ok: true, to: 'Downloads/Archive' });
    for (const bad of ['a/b', '..', 'x:y', 'CON', '']) {
      expect(await h.run('fs_rename', { path: 'Downloads/fixture-04.txt', new_name: bad })).toMatchObject({ error: expect.stringMatching(/INVALID_NAME|EXCLUDED_PATH/) });
    }
    expect(await h.run('fs_rename', { path: 'Downloads', new_name: 'Gone' })).toMatchObject({ error: 'PROTECTED_FOLDER' });
    expect(await h.run('fs_rename', { path: 'Downloads/fixture-04.txt', new_name: '.hidden' })).toMatchObject({ error: 'EXCLUDED_PATH' });

    expect((await h.run('fs_undo', {})).restored).toBe(1);
    expect(existsSync(folder)).toBe(true);
    expect((await h.run('fs_undo', {})).restored).toBe(1);
    expect(await readdir(h.fx.downloads)).toContain('fixture-03.jpg');
    expect((await h.run('fs_undo', {})).restored).toBe(1);
    expect(existsSync(downloadsFile(h, 'fixture-02.png'))).toBe(true);
    expect(await readFile(downloadsFile(h, 'fixture-12.png'), 'utf8')).toBe('fixture 12\n');
  });

  it('mkdir journals each created level; existing folders are not journaled; undo removes them', async () => {
    const h = await setup();
    expect(h.tools.fs_mkdir.preview!({ path: 'Documents/EMU/CS 280' })).toBe('Create folder Documents/EMU/CS 280');
    expect(await h.run('fs_mkdir', { path: 'Documents' })).toMatchObject({ ok: true, existed: true });
    expect(await h.run('fs_mkdir', { path: 'Documents/ADE Trash/x' })).toMatchObject({ error: 'ADE_TRASH_PROTECTED' });
    expect(await h.run('fs_mkdir', { path: 'Desktop/notes.txt' })).toMatchObject({ error: 'NOT_A_FOLDER' });
    expect(existsSync(h.journalPath)).toBe(false);
    const made = await h.run('fs_mkdir', { path: 'Documents/EMU/CS 280' });
    expect(made).toMatchObject({ ok: true, created: ['Documents/EMU', 'Documents/EMU/CS 280'] });
    expect((await h.journal.batchOps(made.batch_id)).map((op) => op.op)).toEqual(['mkdir', 'mkdir']);
    expect(await h.run('fs_undo', {})).toMatchObject({ restored: 0, folders_removed: 2 });
    expect(existsSync(path.join(h.fx.documents, 'EMU'))).toBe(false);
  });
});

describe('journal first', () => {
  it('records every op while the file is still at its source; a failing journal moves nothing', async () => {
    const seen: { op: string; sourceThere: boolean; targetThere: boolean }[] = [];
    let fail = false;
    const h = await setup({
      journal: (inner) => ({
        ...bind(inner),
        async record(op) {
          if (fail) throw new Error('disk full');
          seen.push({
            op: op.op,
            sourceThere: op.fromPath ? existsSync(op.fromPath) : true,
            targetThere: op.op === 'mkdir' ? existsSync(op.toPath!) : (await lstat(op.toPath!)).size > 0,
          });
          await inner.record(op);
        },
      }),
    });
    await h.run('fs_move', { from: 'Documents/resume.pdf', to_folder: 'Documents/Jobs' });
    await h.run('fs_trash', { paths: ['Desktop/notes.txt'] });
    expect(seen).toEqual([
      { op: 'mkdir', sourceThere: true, targetThere: false },
      { op: 'move', sourceThere: true, targetThere: false },               // destination is only ADE's empty placeholder
      { op: 'trash', sourceThere: true, targetThere: false },
    ]);
    fail = true;
    const result = await h.run('fs_move', { from: 'Downloads/fixture-01.pdf', to_folder: 'Downloads' + path.sep + 'PDFs' });
    expect(result.error).toBeTruthy();
    expect(existsSync(downloadsFile(h, 'fixture-01.pdf'))).toBe(true);
    expect(existsSync(path.join(h.fx.downloads, 'PDFs'))).toBe(false);
    const trashed = await h.run('fs_trash', { paths: ['Downloads/fixture-02.png'] });
    expect(trashed).toMatchObject({ ok: false, failed: [{ error: 'JOURNAL_FAILED' }] });
    expect(existsSync(downloadsFile(h, 'fixture-02.png'))).toBe(true);
  });
});

function bind(journal: FileOpsJournal): FileOpsJournal {
  return {
    record: (op) => journal.record(op), lastBatch: () => journal.lastBatch(), batchOps: (id) => journal.batchOps(id),
    markUndone: (id) => journal.markUndone(id), recent: (h) => journal.recent(h),
    trashBatchesOlderThan: (d) => journal.trashBatchesOlderThan(d), markSwept: (id) => journal.markSwept(id),
  };
}

async function realDir(dir: string): Promise<string> {
  return (await import('node:fs/promises')).realpath(dir);
}

describe('A13 + A20 — through the AgentRuntime approval gate', () => {
  function runtimeFor(h: Harness, approved: boolean, calls: ReturnType<typeof toolCall>[]) {
    const bus = new EventBus({ clock: h.clock, sessionId: 'session-1' });
    const gate: WardenGate = { review: vi.fn((r) => (r.risk === 'read' ? 'allow' as const : 'ask' as const)) };
    const approvals: Approvals = {
      request: vi.fn(async (): Promise<ApprovalOutcome> => ({ approved, how: 'user' })),
      resolve: vi.fn(), cancelForJobs: vi.fn(), pending: vi.fn(() => []), dispose: vi.fn(),
    };
    const jobs: JobScheduler = {
      submit: vi.fn(() => ({ status: 'started' as const })), waitFor: vi.fn(), cancel: vi.fn(() => 0), list: vi.fn(() => []),
      onFinished: vi.fn(), pauseClock: vi.fn(), resumeClock: vi.fn(),
    };
    const llm = new FakeLlm([requiresAction(calls), completed('BUBBLE: Done\nSAY: Done.\nSUMMARY: done')]);
    const runtime = new AgentRuntime({ bus, llm, jobs, gate, approvals, settings: () => makeTestSettings(),
      agents: [{ definition: createBeaverAgent(h.tools), assistantId: 'beaver-assistant' }] });
    const outputs = () => llm.calls.filter((c) => c.kind === 'toolOutputs').flatMap((c) => c.outputs.map((o) => JSON.parse(o.output)));
    return { runtime, approvals, outputs };
  }
  const job = { jobId: 'job-1', taskId: 'task-1', kind: 'normal' as const, signal: new AbortController().signal };

  it('A20: a single fs_move still asks, with the move preview, and runs after approval', async () => {
    const h = await setup();
    const r = runtimeFor(h, true, [toolCall('fs_move', { from: 'Documents/resume.pdf', to_folder: 'Documents/Jobs' }, 'c1')]);
    await r.runtime.run('beaver', 'move my resume', job);
    expect(r.approvals.request).toHaveBeenCalledWith(expect.objectContaining({ preview: 'Move resume.pdf → Documents/Jobs' }));
    expect(r.outputs()[0]).toMatchObject({ ok: true, to: 'Documents/Jobs/resume.pdf' });
    expect(existsSync(path.join(h.fx.documents, 'Jobs', 'resume.pdf'))).toBe(true);
  });

  it('A13: declined plan apply and trash → USER_DECLINED, nothing changes, nothing journaled', async () => {
    const h = await setup();
    const plan = await h.run('fs_plan_organize', { path: 'Downloads', strategy: 'by_type' });
    const before = (await readdir(h.fx.downloads)).sort();
    const r = runtimeFor(h, false, [
      toolCall('fs_apply_plan', { plan_id: plan.plan_id }, 'c1'),
      toolCall('fs_trash', { paths: ['Desktop/notes.txt'] }, 'c2'),
    ]);
    await r.runtime.run('beaver', 'clean up', job);
    expect(r.approvals.request).toHaveBeenCalledWith(expect.objectContaining({ preview: expect.stringMatching(/^Move 61 files into \d+ new folders in Downloads \(undo anytime\)$/) }));
    expect(r.approvals.request).toHaveBeenCalledWith(expect.objectContaining({ preview: expect.stringMatching(/^Move 1 file to ADE Trash: notes\.txt/) }));
    expect(r.outputs()).toEqual([{ error: 'USER_DECLINED' }, { error: 'USER_DECLINED' }]);
    expect((await readdir(h.fx.downloads)).sort()).toEqual(before);
    expect(existsSync(path.join(h.fx.desktop, 'notes.txt'))).toBe(true);
    expect(existsSync(h.journalPath)).toBe(false);
    expect((await h.run('fs_apply_plan', { plan_id: plan.plan_id })).moved).toBe(61);   // the plan is still valid afterwards
  });
});

describe('audit fixes (independent Opus review + orchestrator audit)', () => {
  it('M1: a partial trash undo keeps the batch undoable, so nothing is stranded in ADE Trash', async () => {
    const h = await setup();
    await writeFile(path.join(h.fx.desktop, 'a.txt'), 'a');
    await writeFile(path.join(h.fx.downloads, 'b.txt'), 'b');
    await utimes(path.join(h.fx.desktop, 'a.txt'), new Date(Date.now() - DAY), new Date(Date.now() - DAY));
    const trashed = await h.run('fs_trash', { paths: ['Desktop/a.txt', 'Downloads/b.txt'] });
    expect(trashed).toMatchObject({ ok: true, trashed: 2 });

    // Downloads is no longer an allowed folder (or its file is briefly locked): b.txt cannot be restored yet.
    const narrow = { ...h.safe, allowedRoots: [h.fx.desktop, h.fx.documents] };
    const limited = createOrganizeToolBindings({ safe: narrow, index: h.index, journal: h.journal, shell: h.shell, clock: h.clock });
    const first = await limited.fs_undo.execute({}, h.ctx) as Result;
    expect(first).toMatchObject({ ok: true, partial: true, restored: 1, still_in_ade_trash: 1 });
    expect(existsSync(path.join(h.fx.desktop, 'a.txt'))).toBe(true);
    expect((await h.journal.batchOps(trashed.batch_id)).every((op) => !op.undone)).toBe(true);   // still undoable
    h.clock.advance(MINUTE);
    expect(await h.journal.trashBatchesOlderThan(0)).toEqual([trashed.batch_id]);                 // and still sweepable

    const second = await h.run('fs_undo', {});                                                    // Downloads allowed again
    expect(second).toMatchObject({ ok: true, restored: 1 });
    expect(existsSync(path.join(h.fx.downloads, 'b.txt'))).toBe(true);
    expect((await h.journal.batchOps(trashed.batch_id))[0]!.undone).toBe(true);
    expect(await trashLeftovers(h)).toEqual([]);
  });

  it('L5: a link or junction is never renamed, trashed, moved or planned as if it were its target', async () => {
    const h = await setup();
    const target = path.join(h.fx.documents, 'Projects');
    await mkdir(target);
    await writeFile(path.join(target, 'keep.txt'), 'keep');
    await symlink(target, path.join(h.fx.desktop, 'Projects'), 'junction');
    expect(await h.run('fs_rename', { path: 'Desktop/Projects', new_name: 'Old' })).toMatchObject({ error: 'LINK_NOT_FOLLOWED' });
    expect(await h.run('fs_trash', { paths: ['Desktop/Projects'] })).toMatchObject({ ok: false, failed: [expect.objectContaining({ error: 'LINK_NOT_FOLLOWED' })] });
    expect(await h.run('fs_move', { from: 'Desktop/Projects', to_folder: 'Downloads' })).toMatchObject({ error: 'LINK_NOT_FOLLOWED' });
    const plan = await h.run('fs_propose_plan', { title: 'x', moves: [{ from: 'Desktop/Projects', to_folder: 'Downloads' }] });
    expect(plan.plan_id).toBeNull();
    expect(existsSync(target)).toBe(true);                                                         // the real folder is untouched
    expect(await readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('L6: undo refuses a batch that is still being applied', async () => {
    let undoDuringApply: Result | undefined;
    let holder: Harness | undefined;
    const h = await setup({
      journal: (inner) => ({
        ...inner,
        record: async (op: FileOp) => {
          await inner.record(op);
          if (op.op === 'move' && !undoDuringApply && holder) undoDuringApply = await holder.run('fs_undo', { batch_id: op.batchId });
        },
        lastBatch: () => inner.lastBatch(), batchOps: (id: string) => inner.batchOps(id), markUndone: (id: string) => inner.markUndone(id),
        recent: (n: number) => inner.recent(n), trashBatchesOlderThan: (d: number) => inner.trashBatchesOlderThan(d), markSwept: (id: string) => inner.markSwept(id),
      }),
    });
    holder = h;
    const plan = await h.run('fs_plan_organize', { path: 'Downloads', strategy: 'by_type' });
    const applied = await h.run('fs_apply_plan', { plan_id: plan.plan_id });
    expect(applied.ok).toBe(true);
    expect(undoDuringApply).toMatchObject({ error: 'BATCH_IN_PROGRESS' });
    expect((await h.run('fs_undo', {})).ok).toBe(true);                                           // fine once it has finished
  });

  it('case-only rename: a different file that merely folds to the same name is a clash, never overwritten', async () => {
    const h = await setup();
    // U+212A (Kelvin sign) lower-cases to "k" in JavaScript but is a different name on Windows.
    const kelvin = 'Key.txt';
    await writeFile(path.join(h.fx.downloads, 'key.txt'), 'plain k');
    await writeFile(path.join(h.fx.downloads, kelvin), 'kelvin');
    const [a, b] = await Promise.all([stat(path.join(h.fx.downloads, 'key.txt')), stat(path.join(h.fx.downloads, kelvin))]);
    if (a.ino === b.ino) return;                                   // this file system treats them as one name: nothing to guard
    await h.run('fs_rename', { path: `Downloads/${kelvin}`, new_name: 'key.txt' });
    expect(await readFile(path.join(h.fx.downloads, 'key.txt'), 'utf8')).toBe('plain k');          // untouched
    expect(await readFile(path.join(h.fx.downloads, 'key (2).txt'), 'utf8')).toBe('kelvin');
  });

  it('a failed trash leaves nothing for "undo" to pick up', async () => {
    const h = await setup();
    const before = await h.journal.lastBatch();
    const out = await h.run('fs_trash', { paths: ['Downloads/does-not-exist.txt'] });
    expect(out.ok).toBe(false);
    expect(await h.journal.lastBatch()).toBe(before);
  });
});
