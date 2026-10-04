// Live smoke test for Chip's sponsor kit (01-chip-SPONSOR-LANES-SHAFEEN.md §6). Needs real keys in .env.
//   npx tsx scripts/sponsor-smoke.ts
// Prints PASS or FAIL per check and exits non-zero if any check fails. Cleans up what it writes.
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBus } from '../src/main/bus/eventBus';
import { BackboardClient } from '../src/main/runtime/backboard';
import type { OpenAiTool } from '../src/main/runtime/types';
import { assistantIdsFromEnv, readEnvFile, voiceIdsFromEnv } from '../src/main/sponsors/env';
import { createTigerPool, redact, TigerEventSink } from '../src/main/store/tiger';
import { TigerQueries } from '../src/main/store/tigerQueries';
import { ElevenLabsVoice } from '../src/main/voice/elevenlabs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...readEnvFile(join(ROOT, '.env')), ...process.env };
const MODEL = { llm_provider: 'google', model_name: 'gemini-2.5-flash' };
const MOOD_TOOL: OpenAiTool = { type: 'function', function: {
  name: 'report_user_mood', description: "Report your honest read of the user's emotion. Call this first on every turn.",
  parameters: { type: 'object', properties: { mood: { type: 'string', enum: ['calm', 'happy', 'excited', 'stressed', 'angry', 'sad'] }, intensity: { type: 'number' }, reason: { type: 'string' } }, required: ['mood', 'intensity', 'reason'] } } };

let failed = 0;
async function check(name: string, run: () => Promise<string>): Promise<void> {
  try { console.log(`PASS  ${name}: ${await run()}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${redact((e as Error).message).slice(0, 300)}`); }
}
const must = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

async function main(): Promise<void> {
  await check('Backboard', async () => {
    const assistantId = assistantIdsFromEnv(env).chipmunk;
    must(assistantId, 'BB_ASSISTANT_CHIPMUNK is missing: run scripts/create-assistants.ts');
    const client = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY ?? '', defaultModel: MODEL });
    const first = await client.send({ assistantId: assistantId!, content: 'Ugh, nothing is working today!', tools: [MOOD_TOOL], memory: 'off',
      systemPrompt: 'You are Chip. Every turn, call report_user_mood first.' });
    must(first.status === 'REQUIRES_ACTION' && first.tool_calls?.[0]?.function.name === 'report_user_mood', `expected REQUIRES_ACTION with report_user_mood, got ${first.status}`);
    const second = await client.submitToolOutputs(first.thread_id, first.tool_calls!.map((c) => ({ tool_call_id: c.id, output: '{"ok":true}' })));
    must(second.status === 'COMPLETED' && second.content, `expected COMPLETED with text after tool outputs, got ${second.status}`);
    return `report_user_mood(${first.tool_calls![0]!.function.arguments}) → REQUIRES_ACTION → COMPLETED`;
  });

  const voice = new ElevenLabsVoice({ apiKey: env.ELEVENLABS_API_KEY ?? 'missing', voiceIds: voiceIdsFromEnv(env) });
  await check('ElevenLabs speak', async () => {
    let t = Date.now();
    const clip = await voice.speak('chipmunk', 'On it!', 'excited');
    const firstMs = Date.now() - t;
    must(clip.audio.byteLength > 1000, 'no audio returned');
    t = Date.now();
    await voice.speak('chipmunk', 'On it!', 'excited');
    return `Chip said "On it!" (${clip.audio.byteLength} bytes, ${firstMs} ms; repeat from cache ${Date.now() - t} ms${clip.alignment ? ', with lip-sync timing' : ''})`;
  });

  await check('ElevenLabs hear', async () => {
    const sample = await voice.speak('chipmunk', 'Nothing is working today. Ha ha ha, okay, I give up.', 'relieved');
    const heard = await voice.transcribe(sample.audio, 'audio/mpeg');
    must(/nothing is working/i.test(heard.text), `transcript was "${heard.text}"`);
    return `heard "${heard.text}" with cues ${JSON.stringify(heard.cues)}`;
  });

  await check('Tiger', async () => {
    const pool = createTigerPool(env, ROOT);
    try {
      const bus = new EventBus();
      const sink = new TigerEventSink({ db: pool });
      sink.attach(bus);
      const taskId = randomUUID();
      for (let i = 0; i < 10; i++) bus.emit({ type: 'agent.status', agentId: 'chipmunk', taskId, status: 'thinking', detail: `smoke ${i}` });
      await sink.dispose();
      const events = await new TigerQueries(pool).taskEvents(taskId);
      await pool.query('DELETE FROM biome_events WHERE session_id = $1', [bus.sessionId]);
      must(events.length === 10, `wrote 10 events, read back ${events.length}`);
      must(events.every((e, i) => e.type === 'agent.status' && e.detail === `smoke ${i}`), 'events came back out of order');
      return 'wrote 10 events, read 10 back by task_id, in order';
    } finally { await pool.end(); }
  });

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll sponsor checks passed');
  process.exitCode = failed ? 1 : 0;
}
main();
