import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { Clock, TimerHandle } from '../../runtime/types';
import { RealClock } from '../../runtime/clock';
import { isExcludedPath, isWithin, safePath, type SafePathOptions } from './safePath';

export type FileKind = 'image' | 'doc' | 'pdf' | 'sheet' | 'slides' | 'archive' | 'installer' | 'audio' | 'video' | 'code' | 'other';
export interface FileEntry {
  path: string;
  name: string;
  ext: string;
  sizeBytes: number;
  modifiedAt: number;
  kind: FileKind;
}
export interface FileSearchOptions {
  ext?: string;
  modifiedWithinDays?: number;
  folder?: string;
  limit?: number;
}
export interface FileIndexOptions extends SafePathOptions {
  clock?: Clock;
  maxEntries?: number;
  maxDepth?: number;
  watch?: boolean;
}

const kinds: Record<string, FileKind> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
  '.doc': 'doc', '.docx': 'doc', '.txt': 'doc', '.md': 'doc', '.rtf': 'doc',
  '.pdf': 'pdf', '.xls': 'sheet', '.xlsx': 'sheet', '.csv': 'sheet',
  '.ppt': 'slides', '.pptx': 'slides', '.zip': 'archive', '.7z': 'archive', '.rar': 'archive',
  '.exe': 'installer', '.msi': 'installer', '.mp3': 'audio', '.wav': 'audio',
  '.mp4': 'video', '.mov': 'video', '.ts': 'code', '.tsx': 'code', '.js': 'code', '.py': 'code',
};

export class FileIndex {
  private readonly entries = new Map<string, FileEntry>();
  private readonly clock: Clock;
  private readonly maxEntries: number;
  private readonly maxDepth: number;
  private watchers: FSWatcher[] = [];
  private pending = new Map<string, TimerHandle>();
  private roots: string[] = [];
  private trashRoot?: string;
  private ready = false;
  private building?: Promise<void>;

  constructor(private readonly options: FileIndexOptions) {
    this.clock = options.clock ?? new RealClock();
    this.maxEntries = Math.min(options.maxEntries ?? 50_000, 50_000);
    this.maxDepth = Math.min(options.maxDepth ?? 6, 6);
  }

  get isReady(): boolean { return this.ready; }
  get size(): number { return this.entries.size; }
  list(): FileEntry[] { return [...this.entries.values()]; }

  build(): Promise<void> {
    this.building ??= this.rebuild().finally(() => { this.building = undefined; });
    return this.building;
  }

  /** Explicit recovery when a watcher or the initial background scan missed new files. */
  async rescan(folder?: string): Promise<void> {
    if (this.building) await this.building;
    if (!this.ready || !folder) { await this.build(); return; }
    const checked = await safePath(folder, this.options);
    if (!checked.ok) throw new Error('Folder is outside allowed roots');
    await this.refresh(checked.abs);
  }

  private async rebuild(): Promise<void> {
    this.ready = false;
    this.entries.clear();
    this.roots = (await Promise.all(this.options.allowedRoots.map(root => fs.realpath(root).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    })))).filter((root): root is string => root !== undefined);
    const documentsRoot = this.options.documentsRoot
      ? await fs.realpath(this.options.documentsRoot).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }) : undefined;
    this.trashRoot = documentsRoot ? path.join(documentsRoot, 'ADE Trash') : undefined;
    await this.scan(this.roots.map((root) => ({ dir: root, root, depth: 0 })));
    this.ready = true;
    if (this.options.watch) this.startWatching();
  }

  /** Walk directories breadth-first in chunks (one setImmediate per directory) and add their files. Entries are only added, never cleared. */
  private async scan(queue: { dir: string; root: string; depth: number }[]): Promise<void> {
    let seen = this.entries.size;
    while (queue.length && seen < this.maxEntries) {
      const item = queue.shift()!;
      let children: import('node:fs').Dirent[];
      try { children = await fs.readdir(item.dir, { withFileTypes: true }); }
      catch { continue; }
      for (const child of children) {
        if (seen >= this.maxEntries) break;
        const candidate = path.join(item.dir, child.name);
        if (isExcludedPath(candidate, item.root, this.trashRoot)) continue;
        seen++;
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory()) {
          if (item.depth < this.maxDepth) queue.push({ dir: candidate, root: item.root, depth: item.depth + 1 });
        } else if (child.isFile()) {
          // Already inside a real root, not a symlink and not excluded: no need to re-run safePath per file.
          await this.addFile(candidate);
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private async addFile(abs: string): Promise<void> {
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile() || this.entries.size >= this.maxEntries) return;
      const name = path.basename(abs);
      const ext = path.extname(name).toLowerCase();
      this.entries.set(abs.toLowerCase(), { path: abs, name, ext, sizeBytes: stat.size, modifiedAt: stat.mtimeMs, kind: kinds[ext] ?? 'other' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** Apply Archie's own move/create/trash operations to the index immediately. */
  async update(candidate: string): Promise<void> {
    const key = path.resolve(candidate).toLowerCase();
    this.entries.delete(key);
    const checked = await safePath(candidate, this.options);
    if (!checked.ok || isExcludedPath(checked.abs, checked.root, this.trashRoot)) return;
    this.entries.delete(checked.abs.toLowerCase());
    await this.addFile(checked.abs);
  }

  remove(candidate: string): void {
    const key = path.resolve(candidate).toLowerCase();
    for (const [entryKey, entry] of this.entries) {
      if (entryKey === key || isWithin(entry.path, candidate)) this.entries.delete(entryKey);
    }
  }

  async move(from: string, to: string): Promise<void> {
    this.remove(from);
    await this.update(to);
  }

  search(query: string, filters: FileSearchOptions = {}): FileEntry[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ext = filters.ext ? `.${filters.ext.replace(/^\./, '').toLowerCase()}` : undefined;
    const cutoff = filters.modifiedWithinDays === undefined ? -Infinity : this.clock.now() - filters.modifiedWithinDays * 86_400_000;
    const folder = filters.folder ? path.resolve(filters.folder) : undefined;
    return [...this.entries.values()]
      .filter((entry) => (!ext || entry.ext === ext) && entry.modifiedAt >= cutoff && (!folder || isWithin(entry.path, folder)))
      .map((entry) => ({ entry, score: tokens.reduce((score, token) => score + (entry.name.toLowerCase().includes(token) ? 3 : 0) + (entry.path.toLowerCase().includes(token) ? 1 : 0), 0) }))
      .filter(({ score }) => !tokens.length || score >= tokens.length)
      .sort((a, b) => b.score - a.score || b.entry.modifiedAt - a.entry.modifiedAt)
      .slice(0, Math.min(filters.limit ?? 50, 50))
      .map(({ entry }) => entry);
  }

  startWatching(): void {
    this.stopWatching();
    for (const root of this.roots) {
      try {
        const watcher = watch(root, { recursive: true }, (_event, name) => {
          const candidate = name ? path.join(root, name.toString()) : root;
          this.notifyChanged(candidate);
        });
        // An unhandled watcher 'error' crashes the process; Windows raises one when a watched folder is deleted or moved.
        watcher.on('error', () => undefined);
        this.watchers.push(watcher);
      } catch { /* A root may disappear or recursive watch may be unsupported. */ }
    }
  }

  /** Feed a filesystem watcher notification; exposed for deterministic watcher tests. */
  notifyChanged(candidate: string): void {
    const old = this.pending.get(candidate);
    if (old !== undefined) this.clock.clearTimeout(old);
    this.pending.set(candidate, this.clock.setTimeout(() => {
      this.pending.delete(candidate);
      void this.refresh(candidate).catch(() => undefined);
    }, 500));
  }

  private async refresh(candidate: string): Promise<void> {
    let stat: import('node:fs').Stats;
    try { stat = await fs.stat(candidate); }
    catch { this.remove(candidate); return; }
    if (stat.isFile()) { await this.update(candidate); return; }
    if (stat.isDirectory()) {
      // Re-scan just this subtree: a full build() would empty the index and flip isReady while search is in use.
      this.remove(candidate);
      const real = await fs.realpath(candidate).catch(() => undefined);
      const root = real === undefined ? undefined : this.roots.find((r) => isWithin(real, r));
      if (real === undefined || root === undefined || isExcludedPath(real, root, this.trashRoot)) return;
      const depth = path.relative(root, real).split(path.sep).filter(Boolean).length;
      if (depth <= this.maxDepth) await this.scan([{ dir: real, root, depth }]);
    }
  }

  stopWatching(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const timer of this.pending.values()) this.clock.clearTimeout(timer);
    this.pending.clear();
  }
}
