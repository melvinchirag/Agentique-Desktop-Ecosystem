import { homedir } from 'node:os';
import { join } from 'node:path';

/** %APPDATA%/ADE on Windows, ~/.ade elsewhere: settings, ade.db, journals, keys file. */
export function adeDataDir(env: Record<string, string | undefined> = process.env): string {
  return env.APPDATA ? join(env.APPDATA, 'ADE') : join(homedir(), '.ade');
}
