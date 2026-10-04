import { statSync } from 'node:fs';
import path from 'node:path';

/** Shared by Warden and executors; the selected path still needs their normal safety checks. */
export function resolveBareFilename(name: string, roots: readonly string[]): string | undefined {
  if (!name || /[\\/:]/.test(name) || name.startsWith('.')) return undefined;
  let newest: { path: string; modified: number } | undefined;
  for (const root of roots) {
    if (!/^(downloads|desktop|documents)$/i.test(path.basename(root))) continue;
    const candidate = path.resolve(root, name);
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (!newest || stat.mtimeMs > newest.modified)) {
        newest = { path: candidate, modified: stat.mtimeMs };
      }
    } catch { /* A safe folder or file may be missing or unavailable. */ }
  }
  return newest?.path;
}
