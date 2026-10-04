// Inspect Backboard memories for every BB_ASSISTANT_* in .env.
// npx tsx scripts/wipe-memories.ts          # dry run
// npx tsx scripts/wipe-memories.ts --apply  # delete listed memories
import { join } from 'node:path';
import { BackboardClient } from '../src/main/runtime/backboard';
import { readEnvFile } from '../src/main/sponsors/env';
import { adeDataDir } from '../src/main/store/tiger';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('Usage: npx tsx scripts/wipe-memories.ts [--apply]');
  const apply = args.includes('--apply');
  const env = { ...readEnvFile(join(adeDataDir(), '.env')), ...readEnvFile(join(process.cwd(), '.env')), ...process.env };
  if (!env.BACKBOARD_API_KEY) throw new Error('BACKBOARD_API_KEY is missing');
  const assistants = Object.entries(env).filter(([key, id]) => key.startsWith('BB_ASSISTANT_') && !!id)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!assistants.length) throw new Error('No BB_ASSISTANT_* ids found');
  const client = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY });
  console.log(apply ? 'APPLY: deleting listed memories' : 'DRY RUN: no memories will be deleted');
  let failed = false;
  for (const [key, id] of assistants) {
    const base = `/assistants/${encodeURIComponent(id!)}/memories`;
    try {
      const response = await client.request(base, { retry: true });
      const rows = Array.isArray(response.memories) ? response.memories as Record<string, unknown>[] : [];
      console.log(`${key}: ${rows.length} memories`);
      for (const row of rows.slice(0, 3)) console.log(`  - ${String(row.content ?? row.memory ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
      if (apply) {
        for (const row of rows) await client.request(`${base}/${encodeURIComponent(String(row.id))}`, { method: 'DELETE' });
        console.log(`  deleted: ${rows.length}`);
      }
    } catch (error) {
      failed = true;
      console.error(`${key}: ERROR ${error instanceof Error ? error.message.replace(/Bearer\s+\S+/gi, '[redacted]') : String(error)}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
