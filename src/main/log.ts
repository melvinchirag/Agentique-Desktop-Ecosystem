import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

const MAX_BYTES = 1_000_000;

/** Mirrors console.log/warn/error to <dir>/ade.log (one rotation to ade.1.log) so a user can send us what went wrong. */
export function installFileLog(dir: string): string | undefined {
  try { mkdirSync(dir, { recursive: true }); } catch { return undefined; }
  const file = join(dir, 'ade.log');
  const write = (level: string, args: unknown[]): void => {
    try { if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'ade.1.log')); } catch { /* no file yet, or rotation failed */ }
    try { appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...(args as [string, ...unknown[]]))}\n`); } catch { /* never let logging break the app */ }
  };
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { original(...args); write(level.toUpperCase(), args); };
  }
  return file;
}
