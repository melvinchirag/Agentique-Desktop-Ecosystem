import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readEnvFile } from '../sponsors/env';

/** Merge selected values without changing comments, ordering, or unrelated settings. */
export function writeSetupEnv(file: string, values: Record<string, string>, remove: string[] = [], replace = renameSync): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  for (const [key, value] of pending) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error('Invalid setup value');
  }
  const filtered = lines.filter(line => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (!match) return true;
    if (remove.includes(match[1]!)) return false;
    if (!pending.has(match[1]!)) return true;
    pending.delete(match[1]!);
    return true;
  });
  // Replace in place, including all duplicate definitions so stale values cannot win.
  for (let i = 0; i < filtered.length; i++) {
    const match = filtered[i]!.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (match && Object.hasOwn(values, match[1]!)) filtered[i] = `${match[1]}=${values[match[1]!]}`;
  }
  if (filtered.at(-1) === '') filtered.pop();
  for (const [key, value] of pending) filtered.push(`${key}=${value}`);
  const content = `${filtered.join('\n')}\n`;
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
    replace(temp, file);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

export function saveSetupKeys(file: string, backboardKey: string, elevenLabsKey?: string): void {
  const previous = readEnvFile(file);
  const changedAccount = !!previous.BACKBOARD_API_KEY && previous.BACKBOARD_API_KEY !== backboardKey;
  const remove = changedAccount ? Object.keys(previous).filter(key => key.startsWith('BB_ASSISTANT_')) : [];
  writeSetupEnv(file, { BACKBOARD_API_KEY: backboardKey, ...(elevenLabsKey ? { ELEVENLABS_API_KEY: elevenLabsKey } : {}) }, remove);
}
