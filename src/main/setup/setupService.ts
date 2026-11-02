import type { AgentId } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import * as chipmunk from '../agents/chipmunk/memory-rules';
import * as workspace from '../agents/workspace/memory-rules';
import * as wolf from '../agents/wolf/memory-rules';
import * as beaver from '../agents/beaver/memory-rules';
import * as eagle from '../agents/eagle/memory-rules';
import * as ants from '../agents/ants/memory-rules';
import * as butterfly from '../agents/butterfly/memory-rules';
import * as nightingale from '../agents/nightingale/memory-rules';
import { BackboardClient, type CreateAssistantParams } from '../runtime/backboard';
import { AGENT_IDS, readEnvFile, type Env } from '../sponsors/env';
import { withFactFormat, type FactExample } from '../sponsors/memoryFormat';
import { WARDEN_SCREEN_ENV, WARDEN_SCREEN_NAME, WARDEN_SCREEN_PROMPT } from '../sponsors/wardenClassifier';
import { saveSetupKeys, writeSetupEnv } from './envFile';

export type Verification = { status: 'connected'; balance: number } | { status: 'rejected' | 'unreachable' };

export async function verifyBackboardKey(key: string, fetchFn: typeof fetch = fetch): Promise<Verification> {
  try {
    const response = await fetchFn('https://app.backboard.io/api/billing/balance', {
      headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) return { status: 'rejected' };
    if (!response.ok) return { status: 'unreachable' };
    const body = await response.json() as { balance_usd?: unknown };
    return typeof body.balance_usd === 'number' && Number.isFinite(body.balance_usd)
      ? { status: 'connected', balance: body.balance_usd } : { status: 'unreachable' };
  } catch { return { status: 'unreachable' }; }
}

const RULES: Record<AgentId, { FACT_EXTRACTION_PROMPT?: string; UPDATE_MEMORY_PROMPT?: string; FACT_EXAMPLE?: FactExample }> =
  { chipmunk, workspace, wolf, beaver, eagle, ants, butterfly, nightingale };

export type AssistantCreator = Pick<BackboardClient, 'createAssistant'>;
export async function createMissingAssistants(file: string, client: AssistantCreator, progress: (message: string) => void, existingEnv: Env = {}): Promise<void> {
  for (const id of AGENT_IDS) {
    const key = `BB_ASSISTANT_${id.toUpperCase()}`;
    if (readEnvFile(file)[key]) { progress(`${AGENTS[id].displayName}: already set up`); continue; }
    if (existingEnv[key]) { writeSetupEnv(file, { [key]: existingEnv[key] }); progress(`${AGENTS[id].displayName}: already set up`); continue; }
    progress(`${AGENTS[id].displayName}: creating`);
    const profile = AGENTS[id];
    const rule = RULES[id];
    const params: CreateAssistantParams = {
      name: `ADE · ${profile.displayName}`,
      systemPrompt: `You are ${profile.displayName}, the ${profile.animal} of ADE (Agentique Desktop Ecosystem). ${profile.role}`,
      factExtractionPrompt: rule.FACT_EXTRACTION_PROMPT && rule.FACT_EXAMPLE
        ? withFactFormat(rule.FACT_EXTRACTION_PROMPT, rule.FACT_EXAMPLE) : undefined,
      updateMemoryPrompt: rule.UPDATE_MEMORY_PROMPT,
    };
    const { assistantId } = await client.createAssistant(params);
    writeSetupEnv(file, { [key]: assistantId });
    progress(`${profile.displayName}: ready`);
  }
  if (readEnvFile(file)[WARDEN_SCREEN_ENV]) { progress('Warden screen: already set up'); return; }
  if (existingEnv[WARDEN_SCREEN_ENV]) {
    writeSetupEnv(file, { [WARDEN_SCREEN_ENV]: existingEnv[WARDEN_SCREEN_ENV] });
    progress('Warden screen: already set up'); return;
  }
  progress('Warden screen: creating');
  const { assistantId } = await client.createAssistant({ name: WARDEN_SCREEN_NAME, systemPrompt: WARDEN_SCREEN_PROMPT });
  writeSetupEnv(file, { [WARDEN_SCREEN_ENV]: assistantId });
  progress('Warden screen: ready');
}

export async function completeSetup(file: string, backboardKey: string, elevenLabsKey: string | undefined, progress: (message: string) => void, existingEnv: Env = {}): Promise<void> {
  const verification = await verifyBackboardKey(backboardKey);
  if (verification.status !== 'connected') throw new Error(verification.status === 'rejected' ? 'That key was not accepted' : 'Could not reach Backboard');
  saveSetupKeys(file, backboardKey, elevenLabsKey);
  await createMissingAssistants(file, new BackboardClient({ apiKey: backboardKey }), progress,
    existingEnv.BACKBOARD_API_KEY === backboardKey ? existingEnv : {});
}
