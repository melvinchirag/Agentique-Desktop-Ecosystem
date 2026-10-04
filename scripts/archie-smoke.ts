// Live smoke test for Archie's sponsor kit (02-archie-SPONSOR-LANES-SHAFEEN.md §2). Needs real keys in .env.
//   npx tsx scripts/archie-smoke.ts
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackboardClient } from '../src/main/runtime/backboard';
import { BackboardDocuments } from '../src/main/sponsors/backboardDocuments';
import { assistantIdsFromEnv, readEnvFile } from '../src/main/sponsors/env';
import { createTigerPool, redact } from '../src/main/store/tiger';
import { TigerFileOpsJournal } from '../src/main/store/tigerFileOps';
import { TigerHistoryStore } from '../src/main/store/tigerHistory';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...readEnvFile(join(ROOT, '.env')), ...process.env };
const MODEL = { llm_provider: 'google', model_name: 'gemini-2.5-flash' };

let failed = 0;
async function check(name: string, run: () => Promise<string>): Promise<void> {
  try { console.log(`PASS  ${name}: ${await run()}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${redact((e as Error).message).slice(0, 300)}`); }
}
const must = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

async function main(): Promise<void> {
  await check('Ask a file', async () => {
    const assistantId = assistantIdsFromEnv(env).beaver;
    must(assistantId, 'BB_ASSISTANT_BEAVER is missing: run scripts/create-assistants.ts');
    const client = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY ?? '', defaultModel: MODEL });
    const docs = new BackboardDocuments({ apiKey: env.BACKBOARD_API_KEY ?? '' });
    // A fresh job thread: the file goes to the thread, never to the assistant.
    const thread = await client.request(`/assistants/${assistantId}/threads`, { method: 'POST', body: {} });
    const started = Date.now();
    const { documentId } = await docs.uploadToThread(thread.thread_id, join(ROOT, 'tests', 'fixtures', 'syllabus.pdf'));
    const indexed = await docs.waitIndexed(documentId, 60_000);
    must(indexed.status === 'indexed', `document status was ${indexed.status}`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const answer = await client.send({ assistantId: assistantId!, threadId: thread.thread_id, content: 'What does my syllabus say about late work? One sentence.', memory: 'off' });
    must(/12/.test(answer.content ?? '') && /late/i.test(answer.content ?? ''), `the answer did not come from the file: "${answer.content}"`);
    return `uploaded syllabus.pdf → indexed in ${seconds} s (${indexed.chunks} chunks) → "${(answer.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 110)}"`;
  });

  await check('File-ops journal', async () => {
    const pool = createTigerPool(env, ROOT);
    const batchId = `smoke-${randomUUID()}`;
    try {
      const journal = new TigerFileOpsJournal(pool);
      const now = Date.now();
      const ops = ['a.pdf', 'b.png', 'c.docx'].map((name, i) => ({ id: `${batchId}-${i}`, ts: now, jobId: 'smoke-job', batchId, op: 'move' as const,
        fromPath: `C:/Users/demo/Downloads/${name}`, toPath: `C:/Users/demo/Documents/Sorted/${name}`, undone: false }));
      for (const op of ops) await journal.record(op);
      const back = await journal.batchOps(batchId);
      must(back.length === 3 && back.every((op, i) => op.id === ops[i]!.id && op.toPath === ops[i]!.toPath && !op.undone), `read back ${back.length} ops, or out of order`);
      must((await journal.lastBatch()) === batchId, 'lastBatch is not the batch just written');
      const activity = (await new TigerHistoryStore(pool).query('agent_activity', 1, 'beaver')) as any[];
      must(activity[0]?.file_ops >= 3, `agent_activity for beaver has no file_ops count: ${JSON.stringify(activity)}`);
      await journal.markUndone(batchId);
      const undone = await journal.batchOps(batchId);
      must(undone.every((op) => op.undone), 'markUndone did not mark every op');
      must((await journal.lastBatch()) !== batchId, 'an undone batch must not be the last batch');
      return `recorded 3 moves → read 3 back by batch, in order → agent_activity shows ${activity[0].file_ops} file ops → marked undone`;
    } finally {
      await pool.query('DELETE FROM file_ops WHERE batch_id = $1', [batchId]);
      await pool.end();
    }
  });

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll Archie sponsor checks passed');
  process.exitCode = failed ? 1 : 0;
}
main();
