// Export every animal's Backboard memories to a local JSON file OUTSIDE the repo, for import into the
// local memory store (ADE v2, W0 -> W3). Prints agent names and counts only; never a key or a value.
//   npx tsx scripts/export-memories.ts
// Output: %APPDATA%\ADE\exports\memories-<timestamp>.json (mode 0600). Exit 0 on success, 1 if any
// animal failed, 2 if BACKBOARD_API_KEY is missing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackboardClient } from '../src/main/runtime/backboard';
import { BackboardMemoryApi } from '../src/main/sponsors/backboardMemory';
import { AGENT_IDS, assistantIdsFromEnv, readEnvFile } from '../src/main/sponsors/env';
import type { Memory } from '../src/main/runtime/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...readEnvFile(join(ROOT, '.env')), ...process.env };

type AgentExport = { count: number; memories: Memory[] } | { skipped: string } | { error: string };

async function main(): Promise<number> {
  const key = env.BACKBOARD_API_KEY;
  if (!key) { console.error('BACKBOARD_API_KEY is missing: nothing to export.'); return 2; }
  const ids = assistantIdsFromEnv(env);
  const api = new BackboardMemoryApi(new BackboardClient({ apiKey: key }), ids);
  const redact = (s: string) => s.split(key).join('[redacted]').slice(0, 160);

  const agents: Record<string, AgentExport> = {};
  let total = 0, failed = 0;
  for (const id of AGENT_IDS) {
    if (!ids[id]) { agents[id] = { skipped: 'no assistant id in .env' }; console.log(`skip  ${id}: no assistant id`); continue; }
    try {
      const memories = await api.list(id);
      agents[id] = { count: memories.length, memories };
      total += memories.length;
      console.log(`ok    ${id}: ${memories.length} memories`);
    } catch (e) {
      failed++;
      const message = redact(String((e as Error).message));
      agents[id] = { error: message };
      console.log(`FAIL  ${id}: ${message}`);
    }
  }

  const outDir = join(process.env.APPDATA ?? ROOT, 'ADE', 'exports');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(outDir, `memories-${stamp}.json`);
  writeFileSync(file, JSON.stringify({ exported_at: new Date().toISOString(), source: 'backboard', agents }, null, 2), { mode: 0o600 });
  console.log(`wrote ${file}: ${total} memories, ${failed} failed agents`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(String((e as Error).message).slice(0, 200)); process.exit(1); });
