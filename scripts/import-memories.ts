// Import a Backboard memory export (scripts/export-memories.ts) into the local database.
//   npx tsx scripts/import-memories.ts                 newest file in %APPDATA%\ADE\exports
//   npx tsx scripts/import-memories.ts <export.json>   a specific export
// Writes %APPDATA%\ADE\ade.db (or ADE_DATA_DIR/ade.db). Prints agent names and counts only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LocalMemoryStore } from '../src/main/memory/localMemory';
import { AGENT_IDS } from '../src/main/sponsors/env';
import { localDbPath, openLocalDb } from '../src/main/store/localDb';
import type { Memory } from '../src/main/runtime/types';

const dataDir = process.env.ADE_DATA_DIR ?? join(process.env.APPDATA ?? process.cwd(), 'ADE');

function newestExport(dir: string): string | undefined {
  try {
    return readdirSync(dir).filter((f) => f.startsWith('memories-') && f.endsWith('.json')).map((f) => join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  } catch { return undefined; }
}

async function main(): Promise<number> {
  const file = process.argv[2] ?? newestExport(join(dataDir, 'exports'));
  if (!file) { console.error('No export found. Run scripts/export-memories.ts first or pass a path.'); return 2; }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { agents: Record<string, { memories?: Memory[] }> };
  const db = openLocalDb(localDbPath(dataDir));
  const store = new LocalMemoryStore(db);
  let total = 0;
  for (const id of AGENT_IDS) {
    const rows = parsed.agents?.[id]?.memories ?? [];
    if (rows.length === 0) continue;
    const { added, skipped } = await store.importRows(id, rows);
    total += added;
    console.log(`ok    ${id}: ${added} imported, ${skipped} already present or duplicate`);
  }
  db.close();
  console.log(`wrote ${localDbPath(dataDir)}: ${total} memories imported from ${file}`);
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(String((e as Error).message).slice(0, 200)); process.exit(1); });
