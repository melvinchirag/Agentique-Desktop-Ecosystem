import { promises as fs } from 'node:fs';
import path from 'node:path';

export type SafePathResult = { ok: true; abs: string; root: string } | { ok: false; reason: string };
export interface SafePathOptions {
  allowedRoots: readonly string[];
  /** The real Documents folder; its ADE Trash remains allowed when Documents is removed. */
  documentsRoot?: string;
}

const excluded = new Set(['.git', 'node_modules', '$recycle.bin', 'appdata', 'desktop.ini', 'thumbs.db']);
const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;

export function isExcludedPath(abs: string, root: string, trashRoot?: string): boolean {
  const relative = path.relative(root, abs);
  if (relative.split(path.sep).some((part) => excluded.has(part.toLowerCase()) || part.startsWith('.'))) return true;
  return !!trashRoot && isWithin(abs, trashRoot);
}

export function isWithin(candidate: string, root: string): boolean {
  const c = path.normalize(candidate).toLowerCase();
  const r = path.normalize(root).toLowerCase();
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

async function realpathNearest(candidate: string): Promise<string> {
  let current = candidate;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/** Canonicalize a tool path before Warden sees it. No filesystem mutations. */
export async function safePath(input: string, options: SafePathOptions): Promise<SafePathResult> {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, reason: 'EMPTY_PATH' };
  const raw = input.trim();
  const win = raw.replace(/\//g, '\\');
  if (/^\\\\/.test(win) || /^\\[?.]\\/.test(win)) return { ok: false, reason: 'UNC_OR_DEVICE_PATH' };
  if (/^[a-zA-Z]:(?!\\)/.test(win) || /:/.test(win.replace(/^[a-zA-Z]:/, ''))) return { ok: false, reason: 'INVALID_WINDOWS_PATH' };
  if (/[<>"|?*\x00-\x1f]/.test(win) || win.split('\\').some((part) => reserved.test(part.replace(/[ .]+$/, '')) || /[ .]$/.test(part))) {
    return { ok: false, reason: 'INVALID_WINDOWS_PATH' };
  }
  if (path.isAbsolute(raw) && !path.win32.isAbsolute(win) && process.platform === 'win32') return { ok: false, reason: 'INVALID_WINDOWS_PATH' };
  try {
    const roots = await Promise.all(options.allowedRoots.map((root) => fs.realpath(root)));
    if (options.documentsRoot) roots.push(await realpathNearest(path.join(options.documentsRoot, 'ADE Trash')));
    if (!roots.length) return { ok: false, reason: 'OUTSIDE_ALLOWED_FOLDERS' };
    let abs: string;
    if (path.isAbsolute(raw) || path.win32.isAbsolute(win)) {
      abs = path.resolve(raw);
    } else {
      const parts = win.split('\\');
      const named = roots.find((root) => path.basename(root).toLowerCase() === parts[0]?.toLowerCase());
      if (!named) return { ok: false, reason: 'OUTSIDE_ALLOWED_FOLDERS' };
      abs = path.resolve(named, ...parts.slice(1));
    }
    const canonical = await realpathNearest(abs);
    const root = roots.find((allowed) => isWithin(canonical, allowed));
    if (!root) return { ok: false, reason: 'OUTSIDE_ALLOWED_FOLDERS' };
    if (isExcludedPath(canonical, root)) return { ok: false, reason: 'EXCLUDED_PATH' };
    return { ok: true, abs: canonical, root };
  } catch (error) {
    return { ok: false, reason: `PATH_ERROR:${(error as NodeJS.ErrnoException).code ?? 'UNKNOWN'}` };
  }
}
