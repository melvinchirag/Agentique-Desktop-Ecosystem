// Creates one Backboard assistant per animal, each with its own memory rules (docs/SPONSORS.md §2.4).
//   npx tsx scripts/create-assistants.ts            create the missing ones, write BB_ASSISTANT_* to .env
//   npx tsx scripts/create-assistants.ts --force    delete and recreate all of them (their memories are lost)
//   npx tsx scripts/create-assistants.ts --only chipmunk
// The stored system prompt is a short stand-in: the runtime sends the real prompt on every turn.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentId } from '../src/shared/agents';
import { AGENTS } from '../src/shared/config';
import { BackboardClient } from '../src/main/runtime/backboard';
import { AGENT_IDS, readEnvFile, setEnvValue } from '../src/main/sponsors/env';
import { withFactFormat, type FactExample } from '../src/main/sponsors/memoryFormat';
import { WARDEN_SCREEN_ENV, WARDEN_SCREEN_NAME, WARDEN_SCREEN_PROMPT } from '../src/main/sponsors/wardenClassifier';
import * as chipmunk from '../src/main/agents/chipmunk/memory-rules';
import * as workspace from '../src/main/agents/workspace/memory-rules';
import * as wolf from '../src/main/agents/wolf/memory-rules';
import * as beaver from '../src/main/agents/beaver/memory-rules';
import * as eagle from '../src/main/agents/eagle/memory-rules';
import * as ants from '../src/main/agents/ants/memory-rules';
import * as butterfly from '../src/main/agents/butterfly/memory-rules';
import * as nightingale from '../src/main/agents/nightingale/memory-rules';

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const RULES: Record<AgentId, { FACT_EXTRACTION_PROMPT?: string; UPDATE_MEMORY_PROMPT?: string; FACT_EXAMPLE?: FactExample }> =
  { chipmunk, workspace, wolf, beaver, eagle, ants, butterfly, nightingale };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const env = { ...readEnvFile(ENV_PATH), ...process.env };
  const client = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY ?? '' });

  for (const id of AGENT_IDS) {
    if (only && id !== only) continue;
    const key = `BB_ASSISTANT_${id.toUpperCase()}`;
    const existing = env[key];
    if (existing && !force) { console.log(`skip    ${id} (already in .env)`); continue; }
    const profile = AGENTS[id];
    const { assistantId } = await client.createAssistant({
      name: `ADE · ${profile.displayName}`,
      systemPrompt: `You are ${profile.displayName}, the ${profile.animal} of ADE (Agentique Desktop Ecosystem). ${profile.role}`,
      factExtractionPrompt: RULES[id].FACT_EXTRACTION_PROMPT && RULES[id].FACT_EXAMPLE
        ? withFactFormat(RULES[id].FACT_EXTRACTION_PROMPT!, RULES[id].FACT_EXAMPLE!) : undefined,
      updateMemoryPrompt: RULES[id].UPDATE_MEMORY_PROMPT,
    });
    setEnvValue(ENV_PATH, key, assistantId);
    if (existing) await client.deleteAssistant(existing).catch(() => console.log(`        (could not delete the old ${id} assistant)`));
    console.log(`created ${id} → ADE · ${profile.displayName}${RULES[id].FACT_EXTRACTION_PROMPT ? '' : '  (no memory rules)'}  ${key} written to .env`);
  }

  // Warden's second assistant: the injection classifier. No memory prompts; every call sends memory 'off'.
  if (!only || only === 'wolf') {
    const existing = env[WARDEN_SCREEN_ENV];
    if (existing && !force) console.log('skip    warden screen (already in .env)');
    else {
      const { assistantId } = await client.createAssistant({ name: WARDEN_SCREEN_NAME, systemPrompt: WARDEN_SCREEN_PROMPT });
      setEnvValue(ENV_PATH, WARDEN_SCREEN_ENV, assistantId);
      if (existing) await client.deleteAssistant(existing).catch(() => console.log('        (could not delete the old warden screen assistant)'));
      console.log(`created warden screen → ${WARDEN_SCREEN_NAME}  (no memory rules)  ${WARDEN_SCREEN_ENV} written to .env`);
    }
  }
}
main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
