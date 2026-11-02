import { promises as fs, type Dirent, type Stats } from 'node:fs';
import path from 'node:path';
import type { Clock, DocumentsApi, InjectionScreen } from '../../runtime/types';
import { RealClock } from '../../runtime/clock';
import type { FileEntry, FileIndex, FileKind } from '../../connectors/fs/fileIndex';
import type { FsShell } from '../../connectors/fs/fsShell';
import { extractPdfText } from '../../connectors/fs/pdfText';
import { isExcludedPath, isWithin, safePath, type SafePathOptions } from '../../connectors/fs/safePath';
import { SUPPORTED_EXTENSIONS } from '../../sponsors/backboardDocuments';
import type { ToolContext } from '../../../shared/tools';
import type { BeaverBindings } from './index';
import { beaverStatus } from './prompt';

/** Archie spec §4.1 list, widened by the audit (the executor refuses these itself, whatever Warden decides). */
export const BLOCKED_OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jse', '.wsf', '.lnk', '.scr', '.com', '.reg', '.hta', '.jar',
  // Orchestrator audit: more Windows program/script types. The promise is 'never opens programs or scripts'.
  '.pif', '.vbe', '.wsh', '.wsc', '.msp', '.cpl', '.scf', '.url', '.inf', '.chm', '.application', '.gadget', '.appx', '.msix', '.dll', '.psm1',
]);

export interface ReadToolDeps {
  safe: SafePathOptions;
  index: FileIndex;
  shell: FsShell;
  /** Backboard thread documents. Without it `fs_ask_file` answers NOT_AVAILABLE. */
  documents?: DocumentsApi;
  /** Warden's injection screen. Without it the executor wraps file text in `<untrusted>` itself. */
  screen?: InjectionScreen;
  clock?: Clock;
}

type ToolError = { error: string; [key: string]: unknown };

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_READ_CHARS = 4000;
const MAX_READ_CHARS = 8000;
const DESCRIBE_CHARS = 3000;
const LIST_CAP = 200;
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const LIVE_SCAN_DEPTH = 3;
const LIVE_SCAN_CAP = 5000;
const INDEX_TIMEOUT_MS = 60_000;
const PDF_CHARS = 24_000;

const PLAIN_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.log', '.xml', '.yaml', '.yml', '.ini', '.toml', '.html', '.css',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.rb', '.php', '.sql', '.sh',
]);

const KINDS: Record<string, FileKind> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
  '.doc': 'doc', '.docx': 'doc', '.txt': 'doc', '.md': 'doc', '.rtf': 'doc',
  '.pdf': 'pdf', '.xls': 'sheet', '.xlsx': 'sheet', '.csv': 'sheet',
  '.ppt': 'slides', '.pptx': 'slides', '.zip': 'archive', '.7z': 'archive', '.rar': 'archive',
  '.exe': 'installer', '.msi': 'installer', '.mp3': 'audio', '.wav': 'audio',
  '.mp4': 'video', '.mov': 'video', '.ts': 'code', '.tsx': 'code', '.js': 'code', '.py': 'code',
};

const kindOf = (ext: string): FileKind => KINDS[ext] ?? 'other';
const iso = (ms: number): string => new Date(ms).toISOString();
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const str = (input: unknown, key: string): string | undefined => (isRecord(input) && typeof input[key] === 'string' ? (input[key] as string) : undefined);

function int(input: unknown, key: string, min: number, max: number, fallback: number): number {
  const value = isRecord(input) ? input[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function inspectPaths(...keys: string[]): (input: unknown) => { paths?: string[] } {
  return (input) => {
    const paths = keys.map((key) => str(input, key)).filter((p): p is string => p !== undefined);
    return paths.length ? { paths } : {};
  };
}

/** Escape anything in file text or a name that could close or forge our own `<untrusted>` tag. */
const neutralize = (text: string): string => text.replace(/<(\/?untrusted)/gi, '&lt;$1');
const attr = (name: string): string => name.replace(/["<>\r\n]/g, '_');

/**
 * Archie's eight read-only file tools (spec §4.1). Every path goes through `safePath` first, file text is screened and
 * wrapped as untrusted data, and nothing here writes, moves, deletes or runs anything.
 */
export function createReadToolBindings(deps: ReadToolDeps): BeaverBindings {
  const { safe, index, shell, documents, screen } = deps;
  const clock = deps.clock ?? new RealClock();

  let trashRootPromise: Promise<string | undefined> | undefined;
  const trashRoot = (): Promise<string | undefined> => {
    trashRootPromise ??= safe.documentsRoot
      ? fs.realpath(safe.documentsRoot).then((real) => path.join(real, 'ADE Trash'), () => undefined)
      : Promise.resolve(undefined);
    return trashRootPromise;
  };

  const outside = (reason: string): ToolError => ({ error: 'OUTSIDE_ALLOWED_FOLDERS', reason,
    hint: "I can't see that folder — it's outside my allowed folders or unavailable.", allowed: [...safe.allowedRoots] });

  async function resolve(input: unknown, key = 'path'): Promise<{ abs: string; root: string } | ToolError> {
    const raw = str(input, key);
    if (raw === undefined) return { error: 'INVALID_ARGUMENT', hint: `"${key}" must be a string` };
    const checked = await safePath(raw, safe);
    return checked.ok ? { abs: checked.abs, root: checked.root } : outside(checked.reason);
  }

  async function notFound(abs: string): Promise<ToolError> {
    const tokens = path.parse(abs).name.split(/[\s._-]+/).filter((t) => t.length > 1);
    const suggestions = index.isReady && tokens.length
      ? index.search(tokens.join(' '), { limit: 3 }).map((e) => ({ name: e.name, path: e.path }))
      : [];
    return { error: 'NOT_FOUND', suggestions };
  }

  /** Resolve a path argument and stat it. Returns the stats or a ready-made tool error. */
  async function locate(input: unknown, key = 'path'): Promise<{ abs: string; root: string; stat: Stats } | ToolError> {
    const resolved = await resolve(input, key);
    if ('error' in resolved) return resolved;
    try {
      return { ...resolved, stat: await fs.stat(resolved.abs) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return notFound(resolved.abs);
      return { error: 'READ_FAILED', reason: code ?? 'UNKNOWN' };
    }
  }

  const info = (entry: FileEntry) => ({
    name: entry.name, path: entry.path, folder: path.dirname(entry.path), kind: entry.kind, sizeBytes: entry.sizeBytes, modified: iso(entry.modifiedAt),
  });

  const status = (ctx: ToolContext, detail: string): void =>
    ctx.emit({ type: 'agent.status', agentId: 'beaver', taskId: ctx.taskId, status: 'working', detail });

  /** Screened and wrapped file text, or a fail-closed error. Raw text never leaves this function unwrapped. */
  async function untrusted(text: string, name: string, ctx: ToolContext): Promise<{ text: string; flagged: boolean } | ToolError> {
    if (!screen) return { text: `<untrusted source="file:${attr(name)}">${neutralize(text)}</untrusted>`, flagged: false };
    try {
      const result = await screen.screen(text, { kind: 'file', name, taskId: ctx.taskId, jobId: ctx.jobId });
      return { text: result.wrapped, flagged: result.flagged };
    } catch {
      return { error: 'SCREEN_FAILED', hint: 'The file text could not be checked, so it was not returned.' };
    }
  }

  /** First `maxChars` characters of a plain-text file. */
  async function readExcerpt(abs: string, size: number, maxChars: number): Promise<{ text: string; truncated: boolean } | ToolError> {
    const ext = path.extname(abs).toLowerCase();
    if (!PLAIN_TEXT_EXTENSIONS.has(ext)) return { error: 'UNSUPPORTED_TYPE', hint: 'use fs_ask_file' };
    if (size > MAX_FILE_BYTES) return { error: 'TOO_LARGE', hint: 'over 20 MB; use fs_ask_file' };
    const handle = await fs.open(abs, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size, maxChars * 4 + 4));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const decoded = buffer.subarray(0, bytesRead).toString('utf8').replace(/^﻿/, '');
      if (decoded.includes('\0')) return { error: 'UNSUPPORTED_TYPE', hint: 'binary file; use fs_ask_file' };
      return { text: decoded.slice(0, maxChars), truncated: decoded.length > maxChars || bytesRead < size };
    } finally {
      await handle.close();
    }
  }

  async function wrappedExcerpt(input: unknown, maxChars: number, ctx: ToolContext) {
    const found = await locate(input);
    if ('error' in found) return found;
    if (!found.stat.isFile()) return { error: 'NOT_A_FILE' } satisfies ToolError;
    const name = path.basename(found.abs);
    let excerpt: Awaited<ReturnType<typeof readExcerpt>>;
    try { excerpt = await readExcerpt(found.abs, found.stat.size, maxChars); }
    catch (error) { return { error: 'READ_FAILED', reason: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' } satisfies ToolError; }
    if ('error' in excerpt) return { ...excerpt, found, name };
    const wrapped = await untrusted(excerpt.text, name, ctx);
    if ('error' in wrapped) return wrapped;
    return { found, name, wrapped, excerpt };
  }

  // ── fs_list ──────────────────────────────────────────────────────────────
  async function list(input: unknown, ctx: ToolContext): Promise<unknown> {
    const sort = isRecord(input) ? input.sort ?? 'name' : 'name';
    if (!['name', 'modified_desc', 'modified_asc', 'size_desc'].includes(sort as string)) {
      return { error: 'INVALID_ARGUMENT', hint: 'sort must be name, modified_desc, modified_asc, or size_desc' };
    }
    const found = await locate(input);
    if ('error' in found) return found;
    if (!found.stat.isDirectory()) return { error: 'NOT_A_FOLDER' } satisfies ToolError;
    try { await fs.readdir(found.abs); }
    catch (error) { return { error: 'READ_FAILED', reason: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN', hint: "I can't see that folder." }; }
    const depth = int(input, 'depth', 1, 3, 1);
    const trash = await trashRoot();
    const hideTrash = trash !== undefined && !isWithin(found.abs, trash) ? trash : undefined;
    status(ctx, beaverStatus.sniffing(path.basename(found.abs)));
    const items: { name: string; path: string; type: 'file' | 'folder'; sizeBytes?: number; modified: string }[] = [];
    const compare = (a: typeof items[number], b: typeof items[number]): number => {
      const order = sort === 'modified_desc' ? Date.parse(b.modified) - Date.parse(a.modified)
        : sort === 'modified_asc' ? Date.parse(a.modified) - Date.parse(b.modified)
        : sort === 'size_desc' ? (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
        : Number(b.type === 'folder') - Number(a.type === 'folder');
      return order || a.name.localeCompare(b.name);
    };
    let total = 0;
    const queue = [{ dir: found.abs, level: 1 }];
    while (queue.length) {
      const { dir, level } = queue.shift()!;
      let children: Dirent[];
      try { children = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const child of children) {
        const abs = path.join(dir, child.name);
        if (child.isSymbolicLink() || isExcludedPath(abs, found.root, hideTrash)) continue;
        if (!child.isDirectory() && !child.isFile()) continue;
        let stat: Stats;
        try { stat = await fs.stat(abs); } catch { continue; }
        const name = path.relative(found.abs, abs).split(path.sep).join('/');
        items.push(child.isDirectory()
          ? { name, path: abs, type: 'folder', modified: iso(stat.mtimeMs) }
          : { name, path: abs, type: 'file', sizeBytes: stat.size, modified: iso(stat.mtimeMs) });
        total++;
        // Scan every entry before choosing the top results; alphabetic truncation misses newer files.
        if (items.length >= LIST_CAP * 2) {
          if (sort !== 'name') items.sort(compare);
          items.splice(LIST_CAP);
        }
        if (child.isDirectory() && level < depth) queue.push({ dir: abs, level: level + 1 });
      }
    }
    if (sort !== 'name') items.sort(compare);
    items.splice(LIST_CAP);
    return { path: found.abs, count: items.length, truncated: total > LIST_CAP, sort, items };
  }

  // ── fs_search ────────────────────────────────────────────────────────────
  /** Index not ready yet: scan just the named folder (or the allowed roots) live, a few levels deep. */
  async function liveSearch(roots: string[], query: string, exts: string[], within: number | undefined, limit: number): Promise<FileEntry[]> {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const cutoff = within === undefined ? -Infinity : clock.now() - within * 86_400_000;
    const trash = await trashRoot();
    const hits: { entry: FileEntry; score: number }[] = [];
    let seen = 0;
    const queue = roots.map((root) => ({ dir: root, root, depth: 0 }));
    while (queue.length && seen < LIVE_SCAN_CAP) {
      const item = queue.shift()!;
      let children: Dirent[];
      try { children = await fs.readdir(item.dir, { withFileTypes: true }); } catch { continue; }
      for (const child of children) {
        const abs = path.join(item.dir, child.name);
        if (child.isSymbolicLink() || isExcludedPath(abs, item.root, trash)) continue;
        seen++;
        if (child.isDirectory()) { if (item.depth < LIVE_SCAN_DEPTH) queue.push({ dir: abs, root: item.root, depth: item.depth + 1 }); continue; }
        if (!child.isFile()) continue;
        const ext = path.extname(child.name).toLowerCase();
        if (exts.length && !exts.includes(ext)) continue;
        const score = tokens.reduce((s, t) => s + (child.name.toLowerCase().includes(t) ? 3 : 0) + (abs.toLowerCase().includes(t) ? 1 : 0), 0);
        if (tokens.length && score < tokens.length) continue;
        try {
          const stat = await fs.stat(abs);
          if (stat.mtimeMs >= cutoff) hits.push({ score, entry: { path: abs, name: child.name, ext, sizeBytes: stat.size, modifiedAt: stat.mtimeMs, kind: kindOf(ext) } });
        } catch { /* vanished while scanning */ }
      }
    }
    return hits.sort((a, b) => b.score - a.score || b.entry.modifiedAt - a.entry.modifiedAt).slice(0, limit).map((h) => h.entry);
  }

  /** Downloads recency must not depend on a partial background index or name matching. */
  async function latestDownloads(folder: string, root: string, limit: number, exts: string[], within: number | undefined): Promise<FileEntry[]> {
    const children = await fs.readdir(folder, { withFileTypes: true });
    const found: FileEntry[] = [];
    const cutoff = within === undefined ? -Infinity : clock.now() - within * 86_400_000;
    for (const child of children) {
      const abs = path.join(folder, child.name);
      if (!child.isFile() || isExcludedPath(abs, root)) continue;
      try {
        const stat = await fs.stat(abs);
        const ext = path.extname(child.name).toLowerCase();
        if ((exts.length && !exts.includes(ext)) || stat.mtimeMs < cutoff) continue;
        found.push({ path: abs, name: child.name, ext, sizeBytes: stat.size, modifiedAt: stat.mtimeMs, kind: kindOf(ext) });
      } catch { /* A download can disappear while we scan. */ }
    }
    return found.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
  }

  async function search(input: unknown, ctx: ToolContext): Promise<unknown> {
    const rawQuery = str(input, 'query');
    if (rawQuery === undefined) return { error: 'INVALID_ARGUMENT', hint: '"query" must be a string' } satisfies ToolError;
    // "Latest downloaded file" describes recency and location, not words in a filename.
    const latestDownload = /\b(latest|newest|most recent)\b/i.test(rawQuery) && /\b(downloaded|downloads?)\b/i.test(rawQuery);
    const query = latestDownload ? '' : rawQuery;
    const limit = int(input, 'limit', 1, SEARCH_MAX_LIMIT, SEARCH_DEFAULT_LIMIT);
    const rawExt = isRecord(input) && Array.isArray(input.ext) ? input.ext.filter((e): e is string => typeof e === 'string') : [];
    const exts = rawExt.map((e) => `.${e.replace(/^\./, '').toLowerCase()}`).filter((e) => e.length > 1);
    const within = isRecord(input) && typeof input.modified_within_days === 'number' && Number.isFinite(input.modified_within_days)
      ? Math.max(0, Math.floor(input.modified_within_days)) : undefined;
    let folder: string | undefined;
    let folderRoot: string | undefined;
    if (str(input, 'folder') || latestDownload) {
      const resolved = await resolve(str(input, 'folder') ? input : { folder: 'Downloads' }, 'folder');
      if ('error' in resolved) return resolved;
      folder = resolved.abs;
      folderRoot = resolved.root;
      try { await fs.readdir(folder); }
      catch (error) { return { error: 'READ_FAILED', reason: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN', hint: "I can't see that folder." }; }
    }
    status(ctx, beaverStatus.sniffing(folder ? path.basename(folder) : 'your files'));
    if (isRecord(input) && input.refresh === true) {
      try { await index.rescan(folder); }
      catch (error) { return { error: 'READ_FAILED', reason: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN', hint: "I couldn't refresh the file index." }; }
    }

    let entries: FileEntry[];
    if (folder && folderRoot && !query.trim() && path.basename(folder).toLowerCase() === 'downloads') {
      const folders = latestDownload && !str(input, 'folder')
        ? (await Promise.all(safe.allowedRoots.filter(root => path.basename(root).toLowerCase() === 'downloads')
          .map(root => safePath(root, safe)))).filter((result): result is { ok: true; abs: string; root: string } => result.ok)
        : [{ ok: true as const, abs: folder, root: folderRoot }];
      entries = (await Promise.all(folders.map(async item => latestDownloads(item.abs, item.root, limit, exts, within))))
        .flat().sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
    } else if (index.isReady) {
      const run = (ext?: string) => index.search(query, { ...(ext ? { ext } : {}), ...(within !== undefined ? { modifiedWithinDays: within } : {}), ...(folder ? { folder } : {}), limit });
      if (exts.length <= 1) entries = run(exts[0]);
      else {
        // The index filters one extension at a time: merge, drop duplicates, newest first.
        const merged = new Map<string, FileEntry>();
        for (const ext of exts) for (const entry of run(ext)) merged.set(entry.path, entry);
        entries = [...merged.values()].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
      }
    } else {
      const roots = folder ? [folder] : (await Promise.all(safe.allowedRoots.map(root => safePath(root, safe))))
        .flatMap(result => result.ok ? [result.abs] : []);
      entries = await liveSearch(roots, query, exts, within, limit);
    }
    return { count: entries.length, indexReady: index.isReady, results: entries.map(info) };
  }

  // ── fs_info ──────────────────────────────────────────────────────────────
  async function fileInfo(input: unknown): Promise<unknown> {
    const found = await locate(input);
    if ('error' in found) return found;
    const name = path.basename(found.abs);
    const base = { name, path: found.abs, sizeBytes: found.stat.size, modified: iso(found.stat.mtimeMs), created: iso(found.stat.birthtimeMs) };
    if (found.stat.isDirectory()) {
      const trash = await trashRoot();
      const children = await fs.readdir(found.abs, { withFileTypes: true }).catch(() => []);
      const itemCount = children.filter((c) => !c.isSymbolicLink() && !isExcludedPath(path.join(found.abs, c.name), found.root, trash && !isWithin(found.abs, trash) ? trash : undefined)).length;
      return { ...base, type: 'folder', kind: 'folder', itemCount };
    }
    const ext = path.extname(name).toLowerCase();
    return { ...base, type: 'file', kind: kindOf(ext), ext };
  }

  // ── fs_read_text ─────────────────────────────────────────────────────────
  async function readText(input: unknown, ctx: ToolContext): Promise<unknown> {
    const maxChars = int(input, 'max_chars', 1, MAX_READ_CHARS, DEFAULT_READ_CHARS);
    const result = await wrappedExcerpt(input, maxChars, ctx);
    if ('error' in result) { const { found: _f, name: _n, ...error } = result as ToolError; return error; }
    return {
      name: result.name, path: result.found.abs, chars: result.excerpt.text.length, truncated: result.excerpt.truncated,
      ...(result.wrapped.flagged ? { flagged: true } : {}), text: result.wrapped.text,
    };
  }

  // ── fs_describe ──────────────────────────────────────────────────────────
  async function describe(input: unknown, ctx: ToolContext): Promise<unknown> {
    const result = await wrappedExcerpt(input, DESCRIBE_CHARS, ctx);
    if (!('error' in result)) {
      return {
        name: result.name, kind: kindOf(path.extname(result.name).toLowerCase()), size: result.found.stat.size,
        modified: iso(result.found.stat.mtimeMs), ...(result.wrapped.flagged ? { flagged: true } : {}), excerpt: result.wrapped.text,
      };
    }
    // A file we can't read as text still has a name, a kind, a size and a date to talk about.
    const failed = result as ToolError & { found?: { abs: string; stat: Stats }; name?: string };
    if (failed.error === 'UNSUPPORTED_TYPE' && failed.found && failed.name) {
      return {
        name: failed.name, kind: kindOf(path.extname(failed.name).toLowerCase()), size: failed.found.stat.size,
        modified: iso(failed.found.stat.mtimeMs), excerpt: '', hint: 'No text preview for this type; use fs_ask_file for its contents.',
      };
    }
    const { found: _f, name: _n, ...error } = failed;
    return error;
  }

  // ── fs_ask_file ──────────────────────────────────────────────────────────
  async function askFile(input: unknown, ctx: ToolContext): Promise<unknown> {
    const found = await locate(input);
    if ('error' in found) return found;
    if (!found.stat.isFile()) return { error: 'NOT_A_FILE' } satisfies ToolError;
    // PDFs are read on this machine (pdf.js): no upload, works with any brain. The text is screened like any file text.
    if (path.extname(found.abs).toLowerCase() === '.pdf') {
      if (found.stat.size > MAX_FILE_BYTES) return { error: 'TOO_LARGE', hint: 'over 20 MB' } satisfies ToolError;
      status(ctx, 'Reading the PDF…');
      const pdf = await extractPdfText(found.abs, PDF_CHARS);
      if ('error' in pdf) return pdf;
      const wrapped = await untrusted(pdf.text, path.basename(found.abs), ctx);
      if ('error' in wrapped) return wrapped;
      return { ok: true, name: path.basename(found.abs), path: found.abs, pages: pdf.pages, pages_read: pdf.pagesRead, truncated: pdf.truncated,
        text: wrapped.text, flagged: wrapped.flagged, hint: 'Answer from this text; it is the document contents.' };
    }
    if (!documents) return { error: 'NOT_AVAILABLE', hint: 'File Q&A is not set up; try fs_read_text.' } satisfies ToolError;
    if (!ctx.threadId) return { error: 'NO_THREAD', hint: 'No job thread to attach the file to.' } satisfies ToolError;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(found.abs).toLowerCase())) return { error: 'UNSUPPORTED_TYPE', hint: 'Backboard cannot read this file type.' } satisfies ToolError;
    if (found.stat.size > MAX_FILE_BYTES) return { error: 'TOO_LARGE', hint: 'over 20 MB' } satisfies ToolError;
    // Backboard reads uploads internally; inspect extractable text before upload.
    if (screen && PLAIN_TEXT_EXTENSIONS.has(path.extname(found.abs).toLowerCase())) {
      try {
        const handle = await fs.open(found.abs, 'r');
        let excerpt: string;
        try {
          const buffer = Buffer.alloc(Math.min(found.stat.size, 80_000));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          excerpt = buffer.subarray(0, bytesRead).toString('utf8').slice(0, 20_000);
        } finally { await handle.close(); }
        if (excerpt.includes('\0')) return { error: 'UNSUPPORTED_TYPE', hint: 'The file is binary.' } satisfies ToolError;
        await screen.screen(excerpt, { kind: 'doc', name: path.basename(found.abs), taskId: ctx.taskId, jobId: ctx.jobId });
      } catch {
        return { error: 'SCREEN_FAILED', hint: 'The file could not be checked, so it was not uploaded.' } satisfies ToolError;
      }
    }
    // Job thread only, never the assistant (SPONSORS §2.5).
    let documentId: string;
    try { ({ documentId } = await documents.uploadToThread(ctx.threadId, found.abs)); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('UNSUPPORTED_TYPE')) return { error: 'UNSUPPORTED_TYPE', hint: 'Backboard cannot read this file type.' } satisfies ToolError;
      if (message.startsWith('TOO_LARGE')) return { error: 'TOO_LARGE', hint: 'over 20 MB' } satisfies ToolError;
      return { error: 'UPLOAD_FAILED', hint: 'The file could not be attached; try fs_read_text.' } satisfies ToolError;
    }
    const indexed = await documents.waitIndexed(documentId, INDEX_TIMEOUT_MS);
    if (indexed.status !== 'indexed') return { error: 'INDEXING_TIMEOUT', hint: 'Answer from fs_read_text if you can.' } satisfies ToolError;
    return { ok: true, document_id: documentId, chunks: indexed.chunks, name: path.basename(found.abs), path: found.abs };
  }

  // ── fs_open / fs_reveal ──────────────────────────────────────────────────
  async function open(input: unknown): Promise<unknown> {
    const resolved = await resolve(input);
    if ('error' in resolved) return resolved;
    // Refuse programs and scripts here, before anything touches the OS, whatever Warden decided.
    const ext = path.extname(resolved.abs).toLowerCase();
    if (BLOCKED_OPEN_EXTENSIONS.has(ext)) return { error: 'BLOCKED_FILE_TYPE', ext, hint: 'Archie never opens programs or scripts.' } satisfies ToolError;
    const found = await locate(input);
    if ('error' in found) return found;
    if (!found.stat.isFile()) return { error: 'NOT_A_FILE', hint: 'use fs_reveal to show a folder' } satisfies ToolError;
    const failure = await shell.openPath(found.abs);
    return failure ? { error: 'OPEN_FAILED' } satisfies ToolError : { ok: true, opened: path.basename(found.abs) };
  }

  async function reveal(input: unknown): Promise<unknown> {
    const found = await locate(input);
    if ('error' in found) return found;
    shell.showItemInFolder(found.abs);
    return { ok: true, revealed: path.basename(found.abs) };
  }

  return {
    fs_list: { execute: list, inspect: inspectPaths('path') },
    fs_search: { execute: search, inspect: inspectPaths('folder') },
    fs_info: { execute: (input) => fileInfo(input), inspect: inspectPaths('path') },
    fs_read_text: { execute: readText, inspect: inspectPaths('path') },
    fs_describe: { execute: describe, inspect: inspectPaths('path') },
    fs_ask_file: { execute: askFile, inspect: inspectPaths('path') },
    fs_open: { execute: (input) => open(input), inspect: inspectPaths('path') },
    fs_reveal: { execute: (input) => reveal(input), inspect: inspectPaths('path') },
  };
}
