import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import type { ToolContext } from '../../../shared/tools';
import type { BiomeEventInput, Clock, FileOp, FileOpsJournal } from '../../runtime/types';
import type { FileIndex } from '../../connectors/fs/fileIndex';
import type { FsShell } from '../../connectors/fs/fsShell';
import { isExcludedPath, isWithin, safePath, type SafePathOptions } from '../../connectors/fs/safePath';
import type { BeaverBindings } from './index';
import { beaverStatus } from './prompt';
import { PlanStore, type OrganizePlan, type PlannedMove, type SkippedItem } from './planStore';

/**
 * Archie's reversible write tools (spec §4.2, §5, §11).
 * Safety rules: every path passes `safePath`; every change is journaled before it happens; nothing is
 * ever overwritten (destinations are reserved with an exclusive create); "delete" is a move into
 * `Documents/ADE Trash/<batchId>/`; only `sweepOldTrash` calls `shell.trashItem`; nothing here calls
 * `fs.rm`. The only unlinks are of ADE's own empty placeholder, ADE's own unverified copy, and the
 * source of a verified cross-volume copy.
 */
export interface OrganizeToolDeps {
  safe: SafePathOptions;
  index: FileIndex;
  journal: FileOpsJournal;
  shell: FsShell;
  clock: Clock;
  newId?: () => string;
}

export interface SweepDeps {
  safe: SafePathOptions;
  journal: FileOpsJournal;
  shell: FsShell;
  /** Optional sink for the sweep's `agent.status` events (spec §10). */
  emit?: (event: BiomeEventInput) => void;
}

export interface SweepResult {
  swept: string[];
  failed: { batchId: string; error: string }[];
}

const FRESH_MS = 10 * 60 * 1000;
const MAX_MOVES = 500;
const MAX_TRASH = 50;
const BULK_FILES = 25;
const SWEEP_AFTER_DAYS = 7;
const PROGRESS_EVERY = 10;
const MAX_DEPTH = 6;
const MAX_LISTED = 50;
const TRASH_FOLDER = 'ADE Trash';
const BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RECYCLE_BIN_MESSAGE = "That one's in your Recycle Bin now. Right-click → Restore.";

const CATEGORIES: [string, string[]][] = [
  ['Images', ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.tif', '.tiff', '.ico']],
  ['Documents', ['.doc', '.docx', '.txt', '.md', '.rtf', '.odt', '.pages']],
  ['PDFs', ['.pdf']],
  ['Spreadsheets', ['.xls', '.xlsx', '.csv', '.ods', '.numbers']],
  ['Presentations', ['.ppt', '.pptx', '.odp', '.key']],
  ['Archives', ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2']],
  ['Installers', ['.exe', '.msi', '.msix', '.appx', '.dmg', '.pkg']],
  ['Audio', ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg']],
  ['Video', ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv']],
  ['Code', ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.html', '.css', '.json', '.sh', '.ps1', '.bat']],
];
const CATEGORY_BY_EXT = new Map(CATEGORIES.flatMap(([folder, exts]) => exts.map((ext) => [ext, folder] as const)));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The by_type folder a file name belongs in. */
export function typeFolder(name: string): string {
  return CATEGORY_BY_EXT.get(path.extname(name).toLowerCase()) ?? 'Other';
}

/** The by_date folder (relative) for a modified time, in process local time: `2026/10 - October`. */
export function dateFolder(modifiedAt: number): string {
  const date = new Date(modifiedAt);
  return path.join(String(date.getFullYear()), `${String(date.getMonth() + 1).padStart(2, '0')} - ${MONTHS[date.getMonth()]}`);
}

/** `report.pdf`, 2 → `report (2).pdf`. */
export function clashName(target: string, n: number): string {
  const ext = path.extname(target);
  return path.join(path.dirname(target), `${path.basename(target, ext)} (${n})${ext}`);
}

// ── Low-level move ─────────────────────────────────────────────────────────

export interface MoveIo { rename(from: string, to: string): Promise<void> }
export type MoveOutcome = { ok: true; to: string } | { ok: false; error: string };
export interface MoveOptions {
  /** 'number' picks `name (2).ext` when taken; 'skip' fails with TARGET_TAKEN. */
  onClash: 'number' | 'skip';
  /** Runs after the destination is reserved and before the file moves (the journal write). A throw aborts the move. */
  beforeMove: (to: string) => Promise<void>;
  /** Tests inject a rename that fails with EXDEV to exercise copy-verify-delete. */
  io?: MoveIo;
}

const nodeIo: MoveIo = { rename: (from, to) => fs.rename(from, to) };

function code(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.message : String(error));
}

/** Exclusively create an empty placeholder; false when anything already exists there. */
async function reserve(target: string): Promise<boolean> {
  try {
    const handle = await fs.open(target, 'wx');
    await handle.close();
    return true;
  } catch (error) {
    if (code(error) === 'EEXIST') return false;
    throw error;
  }
}

/** Remove ADE's own placeholder, only while it is still an empty regular file. */
async function releasePlaceholder(target: string): Promise<void> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isFile() && stat.size === 0) await fs.unlink(target);
  } catch { /* already gone */ }
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Cross-volume move: copy over ADE's placeholder, verify size + hash, keep the dates, then delete the source. */
async function copyVerifyDelete(from: string, to: string): Promise<MoveOutcome> {
  try {
    await fs.copyFile(from, to);
    const [source, copy] = await Promise.all([fs.stat(from), fs.stat(to)]);
    if (source.size !== copy.size || (await sha256(from)) !== (await sha256(to))) {
      await fs.unlink(to);
      return { ok: false, error: 'COPY_VERIFY_FAILED' };
    }
    await fs.utimes(to, source.atime, source.mtime);
  } catch (error) {
    // `to` was created by ADE's own exclusive reserve, so whatever is there now (an empty placeholder or a
    // half-written copy after a full disk) is ADE's: remove it all, never leave a partial file under the real name.
    await fs.unlink(to).catch(() => undefined);
    return { ok: false, error: code(error) };
  }
  try {
    await fs.unlink(from);
  } catch (error) {
    // The original already vanished (something else removed it after the copy was verified): ADE's verified
    // copy is now the only one, so keep it and report success.
    if (code(error) === 'ENOENT') return { ok: true, to };
    // The source is locked: drop ADE's verified copy so the file exists exactly once, where it was.
    await fs.unlink(to).catch(() => undefined);
    return { ok: false, error: code(error) };
  }
  return { ok: true, to };
}

/**
 * Move one file without ever overwriting: reserve the destination with an exclusive create, run
 * `beforeMove` (journal), then rename over ADE's own placeholder, or copy-verify-delete across volumes.
 */
export async function moveWithoutOverwrite(from: string, to: string, options: MoveOptions): Promise<MoveOutcome> {
  const io = options.io ?? nodeIo;
  let target = to;
  try {
    for (let n = 2; !(await reserve(target)); n += 1) {
      if (options.onClash === 'skip') return { ok: false, error: 'TARGET_TAKEN' };
      if (n > 999) return { ok: false, error: 'TOO_MANY_CLASHES' };
      target = clashName(to, n);
    }
  } catch (error) {
    return { ok: false, error: code(error) };
  }
  try {
    await options.beforeMove(target);
  } catch {
    await releasePlaceholder(target);
    return { ok: false, error: 'JOURNAL_FAILED' };
  }
  try {
    await io.rename(from, target);
    return { ok: true, to: target };
  } catch (error) {
    if (code(error) === 'EXDEV') return copyVerifyDelete(from, target);
    await releasePlaceholder(target);
    return { ok: false, error: code(error) };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

type Args = Record<string, unknown>;
type Checked = { ok: true; abs: string; root: string } | { ok: false; out: Record<string, unknown> };
interface Roots { real: string[]; trash?: string }

function args(input: unknown): Args {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Args : {};
}
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function same(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
function shortName(input: unknown): string {
  return path.basename(str(input).replace(/\\/g, '/')) || str(input);
}
function shownPath(input: unknown): string {
  return str(input).replace(/\\/g, '/').replace(/\/+$/, '');
}
async function lstatOrNull(abs: string): Promise<Stats | null> {
  try { return await fs.lstat(abs); } catch { return null; }
}
async function exists(abs: string): Promise<boolean> {
  return (await lstatOrNull(abs)) !== null;
}
/** True when `candidate` exists and is a different file-system entry than `source` (same device + inode = same entry). */
async function takenByOther(source: string, candidate: string): Promise<boolean> {
  const other = await fs.lstat(candidate, { bigint: true }).catch(() => null);
  if (!other) return false;
  const mine = await fs.lstat(source, { bigint: true }).catch(() => null);
  return !(mine && mine.ino !== 0n && mine.ino === other.ino && mine.dev === other.dev);
}

/** The path as the caller wrote it (no link resolution): absolute as given, or relative to the allowed folder it names. */
function lexicalPath(raw: string, realRoots: string[]): string | undefined {
  const text = raw.trim();
  const win = text.replace(/\//g, '\\');
  if (path.isAbsolute(text) || path.win32.isAbsolute(win)) return path.resolve(text);
  const parts = win.split('\\').filter(Boolean);
  const named = realRoots.find((root) => path.basename(root).toLowerCase() === parts[0]?.toLowerCase());
  return named ? path.resolve(named, ...parts.slice(1)) : undefined;
}

async function loadRoots(safe: SafePathOptions): Promise<Roots> {
  const real = (await Promise.all(safe.allowedRoots.map((root) => fs.realpath(root).catch(() => undefined))))
    .filter((root): root is string => !!root);
  return { real, trash: await resolveTrashRoot(safe) };
}

async function resolveTrashRoot(safe: SafePathOptions): Promise<string | undefined> {
  if (!safe.documentsRoot) return undefined;
  const checked = await safePath(path.join(safe.documentsRoot, TRASH_FOLDER), safe);
  return checked.ok ? checked.abs : undefined;
}

function inTrash(abs: string, roots: Roots): boolean {
  return !!roots.trash && isWithin(abs, roots.trash);
}

/** An allowed root, ADE Trash, or a folder that contains one of them. */
function isProtectedFolder(abs: string, roots: Roots): boolean {
  return [...roots.real, ...(roots.trash ? [roots.trash] : [])].some((root) => isWithin(root, abs));
}

/** `Downloads/PDFs/report.pdf`: names and paths relative to the allowed folder, for events and results. */
function display(abs: string, roots: Roots): string {
  const candidates = [...roots.real, ...(roots.trash ? [roots.trash] : [])].filter((root) => isWithin(abs, root));
  const root = candidates.sort((a, b) => b.length - a.length)[0];
  if (!root) return path.basename(abs);
  return [path.basename(root), ...path.relative(root, abs).split(path.sep).filter(Boolean)].join('/');
}

/** True when a folder between the file and its allowed root (root excluded) is a git repository. */
async function hasGitAncestor(abs: string, root: string): Promise<boolean> {
  for (let dir = path.dirname(abs); isWithin(dir, root) && !same(dir, root); dir = path.dirname(dir)) {
    if (await exists(path.join(dir, '.git'))) return true;
    if (path.dirname(dir) === dir) break;
  }
  return false;
}

async function isLocked(abs: string): Promise<boolean> {
  try {
    const handle = await fs.open(abs, 'r');
    await handle.close();
    return false;
  } catch (error) {
    return ['EBUSY', 'EPERM', 'EACCES'].includes(code(error));
  }
}

/** Remove empty folders inside ADE Trash, bottom-up, never following links and never removing the trash root. */
async function removeEmptyTree(dir: string, trashRoot: string): Promise<void> {
  if (!isWithin(dir, trashRoot) || same(dir, trashRoot)) return;
  const stat = await lstatOrNull(dir);
  if (!stat?.isDirectory()) return;
  for (const child of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (child.isDirectory()) await removeEmptyTree(path.join(dir, child.name), trashRoot);
  }
  await fs.rmdir(dir).catch(() => undefined);
}

function status(ctx: ToolContext, detail: string): void {
  ctx.emit({ type: 'agent.status', agentId: 'beaver', taskId: ctx.taskId, status: 'working', detail });
}

// ── Plan building (shared by fs_plan_organize and fs_propose_plan) ─────────

class PlanBuilder {
  readonly moves: PlannedMove[] = [];
  readonly skipped: SkippedItem[] = [];
  readonly folders: string[] = [];
  readonly newFolders = new Set<string>();
  alreadyInPlace = 0;
  overflow = 0;
  private readonly claimed = new Set<string>();
  private readonly sources = new Set<string>();

  constructor(private readonly roots: Roots, private readonly now: number) {}

  skip(abs: string, reason: string): void {
    this.skipped.push({ path: display(abs, this.roots), reason });
  }

  /** Validate one move and add it with a clash-free destination. `listInPlace` reports files already in that folder. */
  async consider(from: string, root: string, toFolder: string, listInPlace: boolean): Promise<void> {
    if (this.moves.length >= MAX_MOVES) { this.overflow += 1; return; }
    const key = from.toLowerCase();
    if (this.sources.has(key)) return this.skip(from, 'listed twice');
    const stat = await lstatOrNull(from);
    if (!stat) return this.skip(from, 'not found');
    if (!stat.isFile()) return this.skip(from, stat.isDirectory() ? 'is a folder (plans move files only)' : 'not a regular file');
    if (inTrash(from, this.roots)) return this.skip(from, 'in ADE Trash');
    if (inTrash(toFolder, this.roots)) return this.skip(from, 'destination is ADE Trash (use fs_trash to delete)');
    if (same(path.dirname(from), toFolder)) {
      this.alreadyInPlace += 1;
      if (listInPlace) this.skip(from, 'already in that folder');
      return;
    }
    if (this.now - stat.mtimeMs < FRESH_MS) return this.skip(from, 'changed in the last 10 minutes (probably in use)');
    if (await hasGitAncestor(from, root)) return this.skip(from, 'inside a git repository');
    if (await isLocked(from)) return this.skip(from, 'locked or in use');
    const folderStat = await lstatOrNull(toFolder);
    if (folderStat && !folderStat.isDirectory()) return this.skip(from, `${display(toFolder, this.roots)} is not a folder`);

    const base = path.join(toFolder, path.basename(from));
    let target = base;
    for (let n = 2; this.claimed.has(target.toLowerCase()) || await exists(target); n += 1) target = clashName(base, n);
    this.claimed.add(target.toLowerCase());
    this.sources.add(key);
    this.moves.push({ from, to: target, modifiedAt: stat.mtimeMs });
    if (!this.folders.some((folder) => same(folder, toFolder))) {
      this.folders.push(toFolder);
      if (!folderStat) this.newFolders.add(toFolder.toLowerCase());
    }
  }
}

// ── Bindings ───────────────────────────────────────────────────────────────

export type OrganizeToolName =
  | 'fs_plan_organize' | 'fs_propose_plan' | 'fs_apply_plan' | 'fs_move' | 'fs_rename' | 'fs_mkdir' | 'fs_trash' | 'fs_undo';

/** Bindings for Archie's 8 organize/write tools. Read tools are lane T's. */
export function createOrganizeToolBindings(deps: OrganizeToolDeps): Pick<Required<BeaverBindings>, OrganizeToolName> {
  const { safe, index, journal, clock } = deps;
  const plans = new PlanStore(clock);
  /** Batches still being applied in this process: undo refuses them, or it would reverse half a batch that is still growing. */
  const active = new Set<string>();
  /** A failed single change journaled its intent but moved nothing: mark it undone so "undo" skips it and finds the last REAL change. */
  const abandon = (batchId: string): Promise<void> => journal.markUndone(batchId).catch(() => undefined);
  const makeId = deps.newId ?? (() => randomUUID());

  function newBatchId(): string {
    const id = makeId();
    if (!BATCH_ID.test(id)) throw new Error('newId must return a short id of letters, digits, - or _');
    return id;
  }

  function allowedNames(): string[] {
    return safe.allowedRoots.map((root) => path.basename(root));
  }

  async function check(input: unknown): Promise<Checked> {
    const raw = str(input);
    const result = await safePath(raw, safe);
    if (result.ok) return result;
    if (result.reason === 'OUTSIDE_ALLOWED_FOLDERS') return { ok: false, out: { error: 'OUTSIDE_ALLOWED_FOLDERS', path: raw, allowed: allowedNames() } };
    if (result.reason === 'EXCLUDED_PATH') return { ok: false, out: { error: 'EXCLUDED_PATH', path: raw } };
    return { ok: false, out: { error: 'INVALID_PATH', path: raw, reason: result.reason } };
  }

  /** Like check(), but refuses a source that is itself a link or junction: the approval card names the link, so Archie must not act on its target. */
  async function checkSource(input: unknown): Promise<Checked> {
    const checked = await check(input);
    if (!checked.ok) return checked;
    const lexical = lexicalPath(str(input), (await loadRoots(safe)).real);
    const leaf = lexical ? await lstatOrNull(lexical) : null;
    if (leaf?.isSymbolicLink()) return { ok: false, out: { error: 'LINK_NOT_FOLLOWED', path: str(input), hint: 'Archie never acts through links.' } };
    return checked;
  }

  function notFound(input: unknown, roots: Roots): Record<string, unknown> {
    const words = shortName(input).replace(/\.[^.]+$/, '').replace(/[-_.]+/g, ' ');
    const suggestions = index.search(words, { limit: 3 }).map((entry) => display(entry.path, roots));
    return { error: 'NOT_FOUND', path: str(input), suggestions };
  }

  function record(ctx: ToolContext, batchId: string, op: FileOp['op'], fromPath: string | undefined, toPath: string): Promise<void> {
    return journal.record({ id: makeId(), ts: clock.now(), jobId: ctx.jobId, batchId, op, fromPath, toPath, undone: false });
  }

  /** Create a folder and any missing parents, journaling each `mkdir` before it runs. */
  async function ensureFolder(ctx: ToolContext, batchId: string, folder: string, created: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const missing: string[] = [];
    let current = folder;
    for (;;) {
      const stat = await lstatOrNull(current);
      if (stat) {
        if (!stat.isDirectory()) return { ok: false, error: 'NOT_A_FOLDER' };
        break;
      }
      missing.unshift(current);
      const parent = path.dirname(current);
      if (parent === current) return { ok: false, error: 'NOT_FOUND' };
      current = parent;
    }
    for (const level of missing) {
      try { await record(ctx, batchId, 'mkdir', undefined, level); }
      catch { return { ok: false, error: 'JOURNAL_FAILED' }; }
      try { await fs.mkdir(level); }
      catch (error) { if (code(error) !== 'EEXIST') return { ok: false, error: code(error) }; }
      created.push(level);
    }
    return { ok: true };
  }

  async function updateIndex(from: string, to: string | undefined): Promise<void> {
    try {
      if (to) await index.move(from, to);
      else index.remove(from);
    } catch { /* the index is a cache; the watcher catches up */ }
  }

  function storePlan(title: string, builder: PlanBuilder, ctx: ToolContext, roots: Roots, where?: string): Record<string, unknown> {
    const skipped = builder.overflow
      ? [...builder.skipped, { path: where ?? 'plan', reason: `${builder.overflow} more files over the ${MAX_MOVES}-move limit; plan again after this one` }]
      : builder.skipped;
    const folders = builder.folders.map((folder) => display(folder, roots));
    const summary = beaverStatus.plan(builder.moves.length, folders.length);
    if (!builder.moves.length) {
      return { plan_id: null, title, moves: 0, folders: [], skipped: skipped.slice(0, MAX_LISTED), already_in_place: builder.alreadyInPlace, summary: 'Nothing to move.' };
    }
    const plan = plans.put({
      planId: makeId(), title, moves: builder.moves, skipped, folders: builder.folders,
      newFolderCount: builder.newFolders.size, where,
    });
    const sample = plan.moves.slice(0, 10).map((move) => ({ from: display(move.from, roots), to: display(move.to, roots) }));
    ctx.emit({
      type: 'artifact', agentId: 'beaver', taskId: ctx.taskId, kind: 'file_plan', title,
      data: { planId: plan.planId, title, counts: { moves: plan.moves.length, skipped: skipped.length, folders: folders.length }, folders, sample },
    });
    status(ctx, summary);
    return {
      plan_id: plan.planId, title, moves: plan.moves.length, folders, sample,
      skipped: skipped.slice(0, MAX_LISTED), skipped_count: skipped.length, already_in_place: builder.alreadyInPlace,
      expires_in_minutes: 30, summary,
    };
  }

  function applyPreview(input: unknown): string {
    const found = plans.get(args(input).plan_id);
    if (!found.ok) return `Apply plan ${str(args(input).plan_id) || '(none)'}: ${found.error}, nothing will move`;
    const plan = found.plan;
    const total = plan.folders.length;
    const folders = plan.newFolderCount === total ? `${plural(total, 'new folder')}`
      : plan.newFolderCount === 0 ? plural(total, 'folder') : `${plural(total, 'folder')} (${plan.newFolderCount} new)`;
    const text = `Move ${plural(plan.moves.length, 'file')} into ${folders}${plan.where ? ` in ${plan.where}` : ''} (undo anytime)`;
    if (plan.moves.length > BULK_FILES) return text;
    const names = plan.moves.slice(0, 10).map((move) => path.basename(move.from));
    return `${text}: ${names.join(', ')}${plan.moves.length > names.length ? ', …' : ''}`;
  }

  function trashPreview(input: unknown): string {
    const paths = Array.isArray(args(input).paths) ? (args(input).paths as unknown[]) : [];
    const tail = '(undo anytime; emptied to the Recycle Bin after 7 days)';
    if (paths.length > BULK_FILES) {
      const folders = [...new Set(paths.map((p) => path.dirname(shownPath(p)).replace(/\\/g, '/')))].slice(0, 5);
      return `Move ${plural(paths.length, 'file')} to ADE Trash from ${folders.join(', ')} ${tail}`;
    }
    const names = paths.slice(0, 3).map(shortName);
    return `Move ${plural(paths.length, 'file')} to ADE Trash: ${names.join(', ')}${paths.length > 3 ? ', …' : ''} ${tail}`;
  }

  return {
    fs_plan_organize: {
      async execute(input, ctx) {
        const a = args(input);
        const strategy = a.strategy;
        if (strategy !== 'by_type' && strategy !== 'by_date') return { error: 'INVALID_STRATEGY', allowed: ['by_type', 'by_date'] };
        const roots = await loadRoots(safe);
        const checked = await check(a.path);
        if (!checked.ok) return checked.out;
        const folder = checked.abs;
        if (inTrash(folder, roots)) return { error: 'ADE_TRASH_PROTECTED', path: str(a.path) };
        const stat = await lstatOrNull(folder);
        if (!stat) return notFound(a.path, roots);
        if (!stat.isDirectory()) return { error: 'NOT_A_FOLDER', path: str(a.path) };
        const where = display(folder, roots);
        status(ctx, beaverStatus.sniffing(where));

        const builder = new PlanBuilder(roots, clock.now());
        const queue: { dir: string; depth: number }[] = [{ dir: folder, depth: 0 }];
        while (queue.length) {
          const { dir, depth } = queue.shift()!;
          const children = (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
            .sort((x, y) => x.name.localeCompare(y.name));
          for (const child of children) {
            const full = path.join(dir, child.name);
            if (inTrash(full, roots)) continue;
            if (isExcludedPath(full, checked.root)) { builder.skip(full, 'hidden or system item (never touched)'); continue; }
            if (child.isSymbolicLink()) { builder.skip(full, 'link (never followed)'); continue; }
            if (child.isDirectory()) {
              if (a.include_subfolders !== true || depth + 1 > MAX_DEPTH) continue;
              if (await exists(path.join(full, '.git'))) builder.skip(full, 'git repository (left alone)');
              else queue.push({ dir: full, depth: depth + 1 });
              continue;
            }
            if (!child.isFile()) continue;
            let target: string;
            if (strategy === 'by_type') target = path.join(folder, typeFolder(child.name));
            else {
              const fileStat = await lstatOrNull(full);
              if (!fileStat) continue;
              target = path.join(folder, dateFolder(fileStat.mtimeMs));
            }
            await builder.consider(full, checked.root, target, false);
          }
        }
        const title = `Tidy ${where} ${strategy === 'by_type' ? 'by type' : 'by date'}`;
        return storePlan(title, builder, ctx, roots, where);
      },
    },

    fs_propose_plan: {
      async execute(input, ctx) {
        const a = args(input);
        const title = str(a.title).trim();
        if (!title || !Array.isArray(a.moves)) return { error: 'INVALID_ARGUMENTS', hint: 'Give a title and a moves array.' };
        if (a.moves.length > MAX_MOVES) return { error: 'TOO_MANY_MOVES', max: MAX_MOVES };
        const roots = await loadRoots(safe);
        const builder = new PlanBuilder(roots, clock.now());
        for (const item of a.moves as unknown[]) {
          const move = args(item);
          const from = await checkSource(move.from);
          if (!from.ok) { builder.skipped.push({ path: str(move.from), reason: String(from.out.error) }); continue; }
          const to = await check(move.to_folder);
          if (!to.ok) { builder.skipped.push({ path: str(move.from), reason: `destination ${String(to.out.error)}` }); continue; }
          await builder.consider(from.abs, from.root, to.abs, true);
        }
        const common = builder.folders.length
          ? [...new Set(builder.folders.map((folder) => display(folder, roots).split('/')[0]))] : [];
        return storePlan(title, builder, ctx, roots, common.length === 1 ? common[0] : undefined);
      },
    },

    fs_apply_plan: {
      riskFor: () => 'write',
      preview: applyPreview,
      async execute(input, ctx) {
        const found = plans.take(args(input).plan_id);
        if (!found.ok) return { error: found.error, ...(found.error === 'PLAN_EXPIRED' ? { hint: 'Plans last 30 minutes; make a new plan.' } : {}) };
        const plan: OrganizePlan = found.plan;
        const roots = await loadRoots(safe);
        const batchId = newBatchId();
        const created: string[] = [];
        const skipped: SkippedItem[] = [];
        const failed: { from: string; error: string }[] = [];
        let moved = 0;
        const total = plan.moves.length;
        status(ctx, beaverStatus.applying(0, total));
        active.add(batchId);
        try {
        for (const [i, move] of plan.moves.entries()) {
          const progress = () => { if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === total) status(ctx, beaverStatus.applying(i + 1, total)); };
          if (ctx.signal.aborted) { skipped.push({ path: display(move.from, roots), reason: 'cancelled' }); progress(); continue; }
          const from = await check(move.from);
          const folder = await check(path.dirname(move.to));
          const stat = from.ok ? await lstatOrNull(from.abs) : null;
          if (!from.ok || !same(from.abs, move.from) || !stat?.isFile()) skipped.push({ path: display(move.from, roots), reason: 'no longer there' });
          else if (stat.mtimeMs !== move.modifiedAt) skipped.push({ path: display(move.from, roots), reason: 'changed since the plan' });
          else if (!folder.ok || !same(folder.abs, path.dirname(move.to)) || inTrash(folder.abs, roots)) failed.push({ from: display(move.from, roots), error: 'DESTINATION_NOT_ALLOWED' });
          else {
            const made = await ensureFolder(ctx, batchId, folder.abs, created);
            if (!made.ok) failed.push({ from: display(move.from, roots), error: made.error });
            else {
              const result = await moveWithoutOverwrite(from.abs, move.to, {
                onClash: 'number', beforeMove: (to) => record(ctx, batchId, 'move', from.abs, to),
              });
              if (result.ok) { moved += 1; await updateIndex(from.abs, result.to); }
              else failed.push({ from: display(move.from, roots), error: result.error });
            }
          }
          progress();
        }
        } finally {
          active.delete(batchId);
        }
        if (!moved && !created.length) await abandon(batchId);   // journaled nothing real: don't let "undo" pick this empty batch
        const allSkipped = [...plan.skipped, ...skipped];
        return {
          ok: true, batch_id: batchId, moved, folders_created: created.length,
          skipped: allSkipped.slice(0, MAX_LISTED), skipped_count: allSkipped.length, failed: failed.slice(0, MAX_LISTED),
          message: `Moved ${plural(moved, 'file')} into ${plural(plan.folders.length, 'folder')}. Say 'undo' to put them back.`,
        };
      },
    },

    fs_move: {
      preview: (input) => `Move ${shortName(args(input).from)} → ${shownPath(args(input).to_folder)}`,
      async execute(input, ctx) {
        const a = args(input);
        const roots = await loadRoots(safe);
        const from = await checkSource(a.from);
        if (!from.ok) return from.out;
        const stat = await lstatOrNull(from.abs);
        if (!stat) return notFound(a.from, roots);
        if (!stat.isFile()) return { error: 'NOT_A_FILE', path: str(a.from), hint: 'fs_move moves one file.' };
        if (inTrash(from.abs, roots)) return { error: 'ADE_TRASH_PROTECTED', path: str(a.from), hint: 'Use fs_undo to restore trashed files.' };
        const to = await check(a.to_folder);
        if (!to.ok) return to.out;
        if (inTrash(to.abs, roots)) return { error: 'ADE_TRASH_PROTECTED', path: str(a.to_folder), hint: 'Use fs_trash to delete.' };
        const folderStat = await lstatOrNull(to.abs);
        if (folderStat && !folderStat.isDirectory()) return { error: 'NOT_A_FOLDER', path: str(a.to_folder) };
        if (same(path.dirname(from.abs), to.abs)) return { error: 'ALREADY_THERE', path: str(a.from) };

        const batchId = newBatchId();
        const created: string[] = [];
        const made = await ensureFolder(ctx, batchId, to.abs, created);
        if (!made.ok) return { error: made.error, path: str(a.to_folder), batch_id: batchId };
        const result = await moveWithoutOverwrite(from.abs, path.join(to.abs, path.basename(from.abs)), {
          onClash: 'number', beforeMove: (target) => record(ctx, batchId, 'move', from.abs, target),
        });
        if (!result.ok) { if (result.error !== 'JOURNAL_FAILED') await abandon(batchId); return { error: result.error, path: str(a.from), batch_id: batchId }; }
        await updateIndex(from.abs, result.to);
        return {
          ok: true, batch_id: batchId, from: display(from.abs, roots), to: display(result.to, roots),
          renamed_to_avoid_clash: path.basename(result.to) !== path.basename(from.abs), folders_created: created.length,
        };
      },
    },

    fs_rename: {
      preview: (input) => `Rename ${shortName(args(input).path)} → ${str(args(input).new_name)}`,
      async execute(input, ctx) {
        const a = args(input);
        const newName = str(a.new_name).trim();
        if (!newName || /[\\/]/.test(newName) || newName === '.' || newName === '..' || newName.length > 255) {
          return { error: 'INVALID_NAME', new_name: str(a.new_name), hint: 'Give just the new file name, no folders.' };
        }
        const roots = await loadRoots(safe);
        const source = await checkSource(a.path);
        if (!source.ok) return source.out;
        const stat = await lstatOrNull(source.abs);
        if (!stat) return notFound(a.path, roots);
        if (!stat.isFile() && !stat.isDirectory()) return { error: 'NOT_A_FILE', path: str(a.path) };
        if (inTrash(source.abs, roots)) return { error: 'ADE_TRASH_PROTECTED', path: str(a.path) };
        if (stat.isDirectory() && isProtectedFolder(source.abs, roots)) return { error: 'PROTECTED_FOLDER', path: str(a.path) };
        const target = await check(path.join(path.dirname(source.abs), newName));
        if (!target.ok) return { ...target.out, error: target.out.error === 'INVALID_PATH' ? 'INVALID_NAME' : target.out.error, new_name: newName };
        if (!same(path.dirname(target.abs), path.dirname(source.abs)) || inTrash(target.abs, roots)) return { error: 'INVALID_NAME', new_name: newName };
        if (path.basename(source.abs) === newName) return { error: 'SAME_NAME', path: str(a.path) };

        const batchId = newBatchId();
        const wanted = path.join(path.dirname(source.abs), newName);
        let finalPath: string;
        if (same(source.abs, wanted) || stat.isDirectory()) {
          // Case-only renames and folders: Windows never replaces an existing folder, and a case change is the same entry.
          let candidate = wanted;
          // `same()` folds case with JavaScript rules, which are not Windows' rules (and a case-sensitive folder differs
          // again), so "case-only" is decided by file identity: a name that is taken by a DIFFERENT entry is a clash.
          for (let n = 2; await takenByOther(source.abs, candidate); n += 1) {
            if (n > 999) return { error: 'TOO_MANY_CLASHES', batch_id: batchId };
            candidate = clashName(wanted, n);
          }
          try { await record(ctx, batchId, 'rename', source.abs, candidate); }
          catch { return { error: 'JOURNAL_FAILED', path: str(a.path) }; }
          try { await fs.rename(source.abs, candidate); }
          catch (error) { await abandon(batchId); return { error: code(error), path: str(a.path), batch_id: batchId }; }
          finalPath = candidate;
          if (stat.isDirectory()) { index.remove(source.abs); index.notifyChanged(candidate); }
          else await updateIndex(source.abs, candidate);
        } else {
          const result = await moveWithoutOverwrite(source.abs, wanted, {
            onClash: 'number', beforeMove: (to) => record(ctx, batchId, 'rename', source.abs, to),
          });
          if (!result.ok) { if (result.error !== 'JOURNAL_FAILED') await abandon(batchId); return { error: result.error, path: str(a.path), batch_id: batchId }; }
          finalPath = result.to;
          await updateIndex(source.abs, result.to);
        }
        return {
          ok: true, batch_id: batchId, from: display(source.abs, roots), to: display(finalPath, roots),
          renamed_to_avoid_clash: path.basename(finalPath) !== newName,
        };
      },
    },

    fs_mkdir: {
      preview: (input) => `Create folder ${shownPath(args(input).path)}`,
      async execute(input, ctx) {
        const a = args(input);
        const roots = await loadRoots(safe);
        const checked = await check(a.path);
        if (!checked.ok) return checked.out;
        if (inTrash(checked.abs, roots)) return { error: 'ADE_TRASH_PROTECTED', path: str(a.path) };
        const stat = await lstatOrNull(checked.abs);
        if (stat) return stat.isDirectory() ? { ok: true, existed: true, path: display(checked.abs, roots) } : { error: 'NOT_A_FOLDER', path: str(a.path) };
        const batchId = newBatchId();
        const created: string[] = [];
        const made = await ensureFolder(ctx, batchId, checked.abs, created);
        if (!made.ok) return { error: made.error, path: str(a.path), batch_id: batchId };
        return { ok: true, batch_id: batchId, created: created.map((folder) => display(folder, roots)) };
      },
    },

    fs_trash: {
      riskFor: () => 'destructive',
      preview: trashPreview,
      async execute(input, ctx) {
        const paths = args(input).paths;
        if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string')) {
          return { error: 'INVALID_ARGUMENTS', hint: 'paths must be a list of file paths.' };
        }
        if (paths.length > MAX_TRASH) return { error: 'TOO_MANY_FILES', max: MAX_TRASH };
        const roots = await loadRoots(safe);
        if (!roots.trash) return { error: 'TRASH_UNAVAILABLE', hint: 'ADE Trash needs the Documents folder.' };
        const batchId = newBatchId();
        const batchDir = path.join(roots.trash, batchId);
        const trashed: string[] = [];
        const failed: Record<string, unknown>[] = [];
        status(ctx, beaverStatus.trashing(paths.length));
        for (const raw of paths as string[]) {
          const checked = await checkSource(raw);
          if (!checked.ok) { failed.push(checked.out); continue; }
          const stat = await lstatOrNull(checked.abs);
          if (!stat) { failed.push(notFound(raw, roots)); continue; }
          if (inTrash(checked.abs, roots)) { failed.push({ error: 'ALREADY_IN_ADE_TRASH', path: raw }); continue; }
          if (!stat.isFile()) { failed.push({ error: 'NOT_A_FILE', path: raw, hint: 'fs_trash deletes files, not folders.' }); continue; }
          // Keep the folder structure: ADE Trash/<batch>/Downloads/sub/old.txt
          const dest = path.join(batchDir, path.basename(checked.root), path.relative(checked.root, checked.abs));
          if (!isWithin(dest, batchDir) || same(dest, batchDir)) { failed.push({ error: 'INVALID_PATH', path: raw }); continue; }
          try { await fs.mkdir(path.dirname(dest), { recursive: true }); }
          catch (error) { failed.push({ error: code(error), path: raw }); continue; }
          const result = await moveWithoutOverwrite(checked.abs, dest, {
            onClash: 'number', beforeMove: (to) => record(ctx, batchId, 'trash', checked.abs, to),
          });
          if (!result.ok) { failed.push({ error: result.error, path: raw }); continue; }
          trashed.push(display(checked.abs, roots));
          await updateIndex(checked.abs, undefined);
        }
        if (!trashed.length) {
          await abandon(batchId);
          await removeEmptyTree(batchDir, roots.trash);
          return { ok: false, trashed: 0, failed };
        }
        return {
          ok: true, batch_id: batchId, trashed: trashed.length, files: trashed, failed,
          message: `${plural(trashed.length, 'file')} → ADE Trash, undo anytime. Say undo to bring ${trashed.length === 1 ? 'it' : 'them'} back.`,
        };
      },
    },

    fs_undo: {
      preview: (input) => (str(args(input).batch_id) ? `Undo batch ${str(args(input).batch_id)}: put its files back` : "Undo: put Archie's last change back"),
      async execute(input, ctx) {
        const requested = args(input).batch_id;
        if (requested !== undefined && typeof requested !== 'string') return { error: 'INVALID_BATCH_ID' };
        const batchId = (requested as string | undefined)?.trim() || await journal.lastBatch();
        if (!batchId) return { error: 'NOTHING_TO_UNDO' };
        if (!BATCH_ID.test(batchId)) return { error: 'INVALID_BATCH_ID', batch_id: batchId };
        if (active.has(batchId)) return { error: 'BATCH_IN_PROGRESS', batch_id: batchId, hint: 'That change is still running; undo it when it finishes.' };
        const ops = await journal.batchOps(batchId);
        if (!ops.length) return { error: 'UNKNOWN_BATCH', batch_id: batchId };
        if (ops.some((op) => op.swept || op.op === 'sweep')) return { error: 'ALREADY_IN_RECYCLE_BIN', batch_id: batchId, message: RECYCLE_BIN_MESSAGE };
        if (ops.some((op) => op.undone)) return { error: 'ALREADY_UNDONE', batch_id: batchId };

        const roots = await loadRoots(safe);
        const batchTrash = roots.trash ? path.join(roots.trash, batchId) : undefined;
        const skipped: SkippedItem[] = [];
        const keptFolders: string[] = [];
        const renamed: string[] = [];
        let restored = 0;
        let foldersRemoved = 0;
        const skip = (p: string | undefined, reason: string) => skipped.push({ path: p ? display(p, roots) : '(unknown)', reason });

        for (const op of [...ops].reverse()) {
          if (ctx.signal.aborted) return { error: 'CANCELLED', batch_id: batchId, restored, hint: 'Run undo again to finish.' };
          if (op.op === 'mkdir') {
            const folder = op.toPath ? await check(op.toPath) : undefined;
            if (!folder?.ok || inTrash(folder.abs, roots) || isProtectedFolder(folder.abs, roots)) { skip(op.toPath, 'folder outside allowed folders'); continue; }
            const stat = await lstatOrNull(folder.abs);
            if (!stat?.isDirectory()) continue;
            try { await fs.rmdir(folder.abs); foldersRemoved += 1; }
            catch { keptFolders.push(display(folder.abs, roots)); }
            continue;
          }
          if (op.op !== 'move' && op.op !== 'rename' && op.op !== 'trash') continue;
          if (!op.fromPath || !op.toPath) { skip(op.toPath ?? op.fromPath, 'incomplete journal row'); continue; }
          const original = await check(op.fromPath);
          const current = await check(op.toPath);
          if (!original.ok || !current.ok || inTrash(original.abs, roots)) { skip(op.fromPath, 'outside allowed folders'); continue; }
          const currentOk = op.op === 'trash'
            ? !!batchTrash && isWithin(current.abs, batchTrash) && !same(current.abs, batchTrash)
            : !inTrash(current.abs, roots);
          if (!currentOk) { skip(op.fromPath, 'journal row does not match ADE Trash'); continue; }
          const stat = await lstatOrNull(current.abs);
          if (!stat || !(stat.isFile() || (op.op === 'rename' && stat.isDirectory()))) { skip(op.toPath, 'no longer there'); continue; }

          // safePath reports an existing entry's on-disk casing; the journal keeps the original name (case-only renames).
          const parent = path.dirname(original.abs);
          const target = path.join(parent, path.basename(op.fromPath));
          if (!(await exists(parent))) {
            try { await fs.mkdir(parent, { recursive: true }); }
            catch (error) { skip(op.fromPath, code(error)); continue; }
          }
          if (stat.isDirectory() || same(current.abs, target)) {
            if (!same(current.abs, target) && await exists(target)) { skip(op.fromPath, 'original name is taken'); continue; }
            try { await fs.rename(current.abs, target); }
            catch (error) { skip(op.fromPath, code(error)); continue; }
            restored += 1;
            if (stat.isDirectory()) { index.remove(current.abs); index.notifyChanged(target); }
            else await updateIndex(current.abs, target);
            continue;
          }
          const result = await moveWithoutOverwrite(current.abs, target, {
            onClash: op.op === 'trash' ? 'number' : 'skip', beforeMove: async () => undefined,
          });
          if (!result.ok) { skip(op.fromPath, result.error === 'TARGET_TAKEN' ? 'original spot is taken' : result.error); continue; }
          restored += 1;
          if (!same(result.to, target)) renamed.push(display(result.to, roots));
          await updateIndex(current.abs, result.to);
        }
        if (batchTrash && roots.trash && ops.some((op) => op.op === 'trash')) await removeEmptyTree(batchTrash, roots.trash);
        // A trash file that could not be restored (its folder is no longer allowed, a lock, ...) is still inside ADE Trash.
        // Marking the batch undone would hide it from undo AND from the 7-day sweep, stranding it for good: keep it undoable.
        let stillTrashed = 0;
        for (const op of ops) {
          if (op.op === 'trash' && op.toPath && batchTrash && isWithin(op.toPath, batchTrash) && await exists(op.toPath)) stillTrashed += 1;
        }
        if (stillTrashed > 0) {
          return {
            ok: true, partial: true, batch_id: batchId, restored, still_in_ade_trash: stillTrashed,
            skipped: skipped.slice(0, MAX_LISTED), skipped_count: skipped.length,
            hint: 'Some files could not be put back yet. Say undo again to retry; they stay safe in ADE Trash.',
            message: `Put ${plural(restored, 'item')} back; ${stillTrashed} still in ADE Trash.`,
          };
        }
        await journal.markUndone(batchId);
        return {
          ok: true, batch_id: batchId, restored, folders_removed: foldersRemoved, folders_kept: keptFolders,
          restored_under_new_name: renamed.slice(0, MAX_LISTED), skipped: skipped.slice(0, MAX_LISTED), skipped_count: skipped.length,
          message: `Put ${plural(restored, 'item')} back.`,
        };
      },
    },
  };
}

/**
 * The 7-day sweep (spec §4.2): each ADE Trash batch older than 7 days goes to the Windows Recycle Bin via
 * `shell.trashItem`, then the journal marks it swept. A batch that fails stays in ADE Trash for the next sweep.
 */
export async function sweepOldTrash(deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { swept: [], failed: [] };
  const trashRoot = await resolveTrashRoot(deps.safe);
  if (!trashRoot) return result;
  const batches = await deps.journal.trashBatchesOlderThan(SWEEP_AFTER_DAYS);
  if (!batches.length) return result;
  deps.emit?.({ type: 'agent.status', agentId: 'beaver', status: 'working', detail: 'Emptying old ADE Trash' });
  for (const batchId of batches) {
    if (!BATCH_ID.test(batchId)) { result.failed.push({ batchId, error: 'INVALID_BATCH_ID' }); continue; }
    const dir = path.join(trashRoot, batchId);
    if (!isWithin(dir, trashRoot) || same(dir, trashRoot)) { result.failed.push({ batchId, error: 'INVALID_BATCH_ID' }); continue; }
    const ops = await deps.journal.batchOps(batchId);
    if (ops.some((op) => op.op === 'trash' && (!op.toPath || !isWithin(op.toPath, dir)))) {
      // The journal points somewhere else (e.g. Documents moved): leave everything alone.
      result.failed.push({ batchId, error: 'TRASH_LOCATION_CHANGED' });
      continue;
    }
    let stat: Stats | null = null;
    try { stat = await fs.lstat(dir); }
    catch (error) {
      // Only "not found" means already emptied. EPERM / EBUSY / ... mean we can't tell: leave it for the next sweep.
      if (code(error) !== 'ENOENT') { result.failed.push({ batchId, error: code(error) }); continue; }
    }
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) { result.failed.push({ batchId, error: 'NOT_A_FOLDER' }); continue; }
      try { await deps.shell.trashItem(dir); }
      catch (error) { result.failed.push({ batchId, error: error instanceof Error ? error.message : String(error) }); continue; }
    }
    // Missing folder: already emptied (or swept just before a crash); record it so it stops being selected.
    await deps.journal.markSwept(batchId);
    result.swept.push(batchId);
  }
  deps.emit?.({ type: 'agent.status', agentId: 'beaver', status: 'idle' });
  return result;
}
