import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AgentId } from '../../shared/agents';
import designedVoices from '../../../voices/voices.json';

export type Env = Record<string, string | undefined>;

export const AGENT_IDS: AgentId[] = ['chipmunk', 'workspace', 'wolf', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale'];

/** Parse a .env file (KEY=value lines). Missing file → {}. */
export function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Set KEY=value in a .env file, keeping every other line. */
export function setEnvValue(path: string, key: string, value: string): void {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.startsWith(key + '='));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`${key}=${value}`, '');
  }
  writeFileSync(path, lines.join('\n'), { mode: 0o600 });
}

const perAgent = (env: Env, prefix: string): Partial<Record<AgentId, string>> => {
  const out: Partial<Record<AgentId, string>> = {};
  for (const id of AGENT_IDS) {
    const v = env[`${prefix}${id.toUpperCase()}`];
    if (v) out[id] = v;
  }
  return out;
};

/** BB_ASSISTANT_<AGENT> → assistant ids. */
export const assistantIdsFromEnv = (env: Env) => perAgent(env, 'BB_ASSISTANT_');
/** The team's designed voices, committed in voices/voices.json (voice IDs are identifiers, not keys). */
export const DESIGNED_VOICE_IDS: Partial<Record<AgentId, string>> = Object.fromEntries(
  AGENT_IDS.flatMap((id) => {
    const v = (designedVoices as Record<string, { voice_id?: unknown } | undefined>)[id]?.voice_id;
    return typeof v === 'string' && v ? [[id, v]] : [];
  }),
);

/** EL_VOICE_<AGENT> → voice ids. A missing line falls back to the designed voice; .env always wins. */
export const voiceIdsFromEnv = (env: Env, designed: Partial<Record<AgentId, string>> = DESIGNED_VOICE_IDS) =>
  ({ ...designed, ...perAgent(env, 'EL_VOICE_') });
