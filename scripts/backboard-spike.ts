// Backboard spike: proves the real API shape with one throwaway assistant, then deletes it.
//   npx tsx scripts/backboard-spike.ts
// Prints both responses of a tool-call round trip and 20 model names. Findings live in docs/sponsor-verify.md.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackboardClient } from '../src/main/runtime/backboard';
import { readEnvFile } from '../src/main/sponsors/env';
import type { OpenAiTool } from '../src/main/runtime/types';

const env = { ...readEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env')), ...process.env };
const MODEL = { llm_provider: 'google', model_name: 'gemini-2.5-flash' };
const TOOL: OpenAiTool = { type: 'function', function: {
  name: 'report_user_mood', description: 'Report how the user feels. Always call this first.',
  parameters: { type: 'object', properties: { mood: { type: 'string' }, intensity: { type: 'number' } }, required: ['mood', 'intensity'] } } };

async function main(): Promise<void> {
  const client = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY ?? '', defaultModel: MODEL });
  const { assistantId } = await client.createAssistant({ name: 'ADE · spike (throwaway)', systemPrompt: 'You are a test assistant.' });
  try {
    const first = await client.send({ assistantId, content: 'I am so annoyed, nothing works today! Call report_user_mood.', tools: [TOOL], memory: 'off' });
    console.log('1) message with a tool:\n', JSON.stringify(first, null, 2));
    if (first.tool_calls?.length) {
      const second = await client.submitToolOutputs(first.thread_id, first.tool_calls.map((c) => ({ tool_call_id: c.id, output: '{"ok":true}' })));
      console.log('2) after tool outputs:\n', JSON.stringify(second, null, 2));
    }
    const models = await client.listModels({ limit: 20 });
    console.log('3) models:', models.map((m) => `${m.provider}/${m.name}`).join(', '));
  } finally {
    await client.deleteAssistant(assistantId);
  }
}
main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
