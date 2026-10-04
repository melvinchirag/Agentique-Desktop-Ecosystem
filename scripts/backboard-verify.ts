// Repeatable Backboard verification (docs/lanes/BACKBOARD-V1.md). Prints only names, statuses and short synthetic answers.
//   npx tsx scripts/backboard-verify.ts inventory   which BB_ASSISTANT_* / EL_VOICE_* variables are set (names only, no calls)
//   npx tsx scripts/backboard-verify.ts ready       one "READY" call per assistant (memory off, no tools)
//   npx tsx scripts/backboard-verify.ts scout       Scout web search (one call)
//   npx tsx scripts/backboard-verify.ts             all three, in that order
// Every call uses memory 'off' and synthetic text. Stops on the first 401/403. Keys are never printed.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackboardClient, BackboardError } from '../src/main/runtime/backboard';
import { AGENT_IDS, readEnvFile, type Env } from '../src/main/sponsors/env';
import { WARDEN_SCREEN_ENV } from '../src/main/sponsors/wardenClassifier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env: Env = { ...readEnvFile(join(ROOT, '.env')), ...process.env };
const MODEL = { llm_provider: 'google', model_name: 'gemini-2.5-flash' };
const SECRET_NAMES = ['BACKBOARD_API_KEY', 'ELEVENLABS_API_KEY', 'TIGER_DATABASE_URL'];

/** Replace any secret value (and any long key-looking token) before text reaches the console. */
function redact(text: string): string {
  let out = text;
  for (const name of SECRET_NAMES) { const v = env[name]; if (v && v.length > 6) out = out.split(v).join('[redacted]'); }
  return out.replace(/\b(?:sk|bb|xi)[-_][A-Za-z0-9_-]{12,}/g, '[redacted]');
}
const short = (s: string | null | undefined, n = 120) => redact((s ?? '').replace(/\s+/g, ' ').trim()).slice(0, n);
const say = (line: string) => console.log(redact(line));
let blockedByAuth = false;

function inventory(): void {
  say('## Inventory (names only)');
  say(`BACKBOARD_API_KEY: ${env.BACKBOARD_API_KEY ? 'set' : 'MISSING'}`);
  say(`ELEVENLABS_API_KEY: ${env.ELEVENLABS_API_KEY ? 'set' : 'MISSING'}`);
  for (const id of AGENT_IDS) say(`BB_ASSISTANT_${id.toUpperCase()}: ${env[`BB_ASSISTANT_${id.toUpperCase()}`] ? 'set' : 'MISSING'}`);
  say(`${WARDEN_SCREEN_ENV}: ${env[WARDEN_SCREEN_ENV] ? 'set' : 'MISSING'}`);
  for (const id of AGENT_IDS) say(`EL_VOICE_${id.toUpperCase()}: ${env[`EL_VOICE_${id.toUpperCase()}`] ? 'set' : 'MISSING'}`);
}

/** 401/403 means the key or account is wrong: report it and stop, never loop. */
function describeError(e: unknown): string {
  if (e instanceof BackboardError) {
    if (e.status === 401 || e.status === 403) blockedByAuth = true;
    return `HTTP ${e.status}${e.status === 404 ? ' (assistant not found on this key\'s account?)' : ''}: ${short(e.body, 160)}`;
  }
  return short((e as Error).message, 200);
}

function client(): BackboardClient {
  return new BackboardClient({ apiKey: env.BACKBOARD_API_KEY ?? '', defaultModel: MODEL });
}

async function ready(): Promise<void> {
  say('\n## READY check (memory off, no tools, google/gemini-2.5-flash)');
  const bb = client();
  const targets = [...AGENT_IDS.map((id) => ({ name: id, key: `BB_ASSISTANT_${id.toUpperCase()}` })), { name: 'warden-screen', key: WARDEN_SCREEN_ENV }];
  for (const t of targets) {
    if (blockedByAuth) { say(`BLOCKED ${t.name}: stopped after an auth error`); continue; }
    const assistantId = env[t.key];
    if (!assistantId) { say(`BLOCKED ${t.name}: ${t.key} is missing`); continue; }
    try {
      const r = await bb.send({ assistantId, content: 'Reply with the single word READY.', memory: 'off', model: MODEL });
      const ok = r.status === 'COMPLETED' && !!r.content?.trim();
      say(`${ok ? 'PASS   ' : 'FAIL   '} ${t.name}: status=${r.status} content="${short(r.content, 40)}"`);
    } catch (e) { say(`FAIL    ${t.name}: ${describeError(e)}`); }
  }
}

/** Describe a value's shape without printing long text. */
function shapeOf(v: unknown, depth = 0): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})${v.length && depth < 2 ? ` of ${shapeOf(v[0], depth + 1)}` : ''}`;
  if (typeof v === 'object') return depth >= 2 ? 'object' : `{${Object.entries(v as object).map(([k, x]) => `${k}: ${shapeOf(x, depth + 1)}`).join(', ')}}`;
  if (typeof v === 'string') return `string(${v.length})`;
  return typeof v;
}

async function scout(): Promise<void> {
  say('\n## Scout web search (eagle, web_search Auto, memory off)');
  const assistantId = env.BB_ASSISTANT_EAGLE;
  if (!assistantId) { say('BLOCKED scout: BB_ASSISTANT_EAGLE is missing'); return; }
  if (blockedByAuth) { say('BLOCKED scout: stopped after an auth error'); return; }
  try {
    // Raw request so the response shape (citations, sources) is visible; LlmResponse drops those fields.
    const raw = await client().request('/threads/messages', { method: 'POST', retry: true, timeoutMs: 60_000, body: {
      assistant_id: assistantId, content: 'In one sentence: what is the capital of Michigan? Name the source.', stream: false,
      llm_provider: MODEL.llm_provider, model_name: MODEL.model_name, memory: 'off', web_search: 'Auto' } });
    const content = typeof raw.content === 'string' ? raw.content : '';
    const mentionsLansing = /lansing/i.test(content);
    say(`${raw.status === 'COMPLETED' && mentionsLansing ? 'PASS' : 'FAIL'}    scout: status=${raw.status} mentions Lansing=${mentionsLansing}`);
    say(`  answer: "${short(content, 220)}"`);
    const sourceLike = Object.keys(raw).filter((k) => /source|citation|search|url|retrieved|web/i.test(k));
    say(`  source/citation-like keys: ${sourceLike.length ? sourceLike.join(', ') : '(none)'}`);
    for (const k of sourceLike) say(`    ${k}: ${shapeOf(raw[k])}`);
    say(`  all response keys: ${Object.keys(raw).join(', ')}`);
    say(`  URL-like text in the answer: ${/https?:\/\/|\bwww\./i.test(content) ? 'yes' : 'no'}`);
  } catch (e) { say(`FAIL    scout: ${describeError(e)}`); }
}

async function main(): Promise<void> {
  const step = process.argv[2];
  if (!step || step === 'inventory') inventory();
  if (!step || step === 'ready') await ready();
  if (!step || step === 'scout') await scout();
  if (blockedByAuth) { say('\nSTOP: Backboard answered 401/403. Wrong key or account; nothing more was called.'); process.exitCode = 2; }
}
main().catch((e) => { console.error(redact(String((e as Error).message ?? e))); process.exit(1); });
