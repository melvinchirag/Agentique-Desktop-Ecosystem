// Designs original ElevenLabs voices for the ADE animals (Voice Design, no cloning).
//   npx tsx scripts/design-voices.ts --agent chipmunk     design previews for one animal (--only works too)
//   npx tsx scripts/design-voices.ts --all                design previews for every animal without previews
//   npx tsx scripts/design-voices.ts --pick chipmunk=2    create the permanent voice from preview 2
// Add --force to redo an animal that already has previews.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, '.env');
const PREVIEW_DIR = join(ROOT, 'voices', 'previews');
const VOICES_JSON = join(ROOT, 'voices', 'voices.json');
const API = 'https://api.elevenlabs.io/v1';
const DESIGN_MODEL = 'eleven_multilingual_ttv_v2';

interface VoiceSpec { name: string; env: string; description: string; text: string }

// Descriptions: docs/SPONSORS.md §3.2. Preview text is padded in character (the API needs at least 100 characters).
const VOICES: Record<string, VoiceSpec> = {
  chipmunk: {
    name: 'Chip', env: 'EL_VOICE_CHIPMUNK',
    description: 'A tiny, bright, high-pitched cartoon chipmunk. Fast, excitable, warm, slightly squeaky, youthful, very expressive.',
    text: "Ooh! Hi hi hi! I'm Chip! Want me to check your emails? Scout's already stretching his wings! Just say the word and the whole biome gets to work for you!"
  },
  wolf: {
    name: 'Warden', env: 'EL_VOICE_WOLF',
    description: 'A deep, calm, clear guardian with a wolf in his voice: a low rumbling growl sits under every word, slightly gravelly and husky, with a faint wolfish rasp at the start of phrases. Slow, steady, few words, protective, serious, never mean. Clear and easy to understand.',   // tuned from SPONSORS §3.2 after the first previews
    text: "Not on my watch. Drafts only. I check every action before it happens, and I always ask you first. Nothing leaves this desktop without your say."
  },
  workspace: {
    name: 'Pixel', env: 'EL_VOICE_WORKSPACE',
    description: 'A friendly, crisp, clever, upbeat assistant character. A little techy and precise, bright and helpful.',
    text: "Inbox sorted! Three letters need you. I drafted a reply in your style and left it waiting in your drafts, so you can read it and hit send yourself."
  },
  beaver: {
    name: 'Archie', env: 'EL_VOICE_BEAVER',
    description: 'Friendly, practical working-guy voice; upbeat, a bit goofy, warm, mid-range, proud of tidy work.',   // 02-archie-files.md §9
    text: "Dam's built! Thirty-seven files, five folders, and not one out of place. Everything from your Downloads is sorted nice and neat. Just say undo and I'll put it all right back."
  },
  eagle: {
    name: 'Scout', env: 'EL_VOICE_EAGLE',
    description: 'A crisp, confident, sharp eagle. News-anchor energy, clear and concise, sees far.',
    text: "Eyes on target. Three pizza spots found, all within a ten minute walk. Sources are in the brief. The top pick is open late and has the best reviews."
  },
  ants: {
    name: 'Swarm', env: 'EL_VOICE_ANTS',
    description: 'A very high, tiny, energetic voice, like a small eager ant. Quick, bright, cheerful, marching rhythm.',
    text: "We are Swarm! Plan assembled! Four steps, two hours, one break for snacks. Every ant knows its job, and we carry each task right where it needs to go!"
  },
  butterfly: {
    name: 'Iris', env: 'EL_VOICE_BUTTERFLY',
    description: 'A light, airy, cheerful young butterfly. Playful, stylish, quick and bubbly.',
    text: "Ooh, this post is going to sparkle! I wrote three versions for you, short, sweet, and a little bold. Pick your favorite and share it whenever you like!"
  },
  nightingale: {
    name: 'Celene', env: 'EL_VOICE_NIGHTINGALE',
    description: 'A warm, smooth, melodic diva nightingale. Elegant, soulful, unhurried, a little dramatic.',
    text: "Let me set the mood, darling. Something soft and slow for a long night, a little melody to carry you through. Close your eyes, breathe, and listen."
  }
};
const ORDER = ['chipmunk', 'wolf', 'workspace', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale'];

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(ENV_PATH)) return out;
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}
function setEnv(key: string, value: string): void {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
  const i = lines.findIndex(l => l.startsWith(key + '='));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else { if (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push(`${key}=${value}`, ''); }
  writeFileSync(ENV_PATH, lines.join('\n'), { mode: 0o600 });
}
type Store = Record<string, { name: string; description: string; previews: { n: number; file: string; generated_voice_id: string }[]; voice_id?: string; picked?: number }>;
const loadStore = (): Store => existsSync(VOICES_JSON) ? JSON.parse(readFileSync(VOICES_JSON, 'utf8')) : {};
const saveStore = (s: Store) => { mkdirSync(dirname(VOICES_JSON), { recursive: true }); writeFileSync(VOICES_JSON, JSON.stringify(s, null, 2) + '\n'); };

async function api(path: string, body: object, key: string): Promise<any> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${path} returned ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

async function design(agent: string, key: string, force: boolean): Promise<void> {
  const spec = VOICES[agent]; if (!spec) throw new Error(`Unknown agent "${agent}". Use one of: ${ORDER.join(', ')}`);
  const store = loadStore();
  if (store[agent]?.previews?.length && !force) { console.log(`${agent}: previews already exist (use --force to redo)`); return; }
  const result = await api('/text-to-voice/design', { model_id: DESIGN_MODEL, voice_description: spec.description, text: spec.text }, key);
  const previews = result.previews ?? [];
  if (!previews.length) throw new Error(`No previews returned. Response keys: ${Object.keys(result).join(', ')}`);
  mkdirSync(PREVIEW_DIR, { recursive: true });
  store[agent] = { name: spec.name, description: spec.description, previews: [] };
  previews.forEach((p: any, i: number) => {
    const file = `voices/previews/${agent}-${i + 1}.mp3`;
    writeFileSync(join(ROOT, file), Buffer.from(p.audio_base_64, 'base64'));
    store[agent].previews.push({ n: i + 1, file, generated_voice_id: p.generated_voice_id });
    console.log(`${agent}: saved ${file}`);
  });
  saveStore(store);
}

async function pick(arg: string, key: string): Promise<void> {
  const [agent, nText] = arg.split('='); const n = Number(nText);
  const spec = VOICES[agent]; const store = loadStore();
  const preview = store[agent]?.previews.find(p => p.n === n);
  if (!spec || !preview) throw new Error(`No preview ${nText} for "${agent}". Run --agent ${agent} first.`);
  const result = await api('/text-to-voice', { voice_name: `ADE ${spec.name}`, voice_description: spec.description, generated_voice_id: preview.generated_voice_id }, key);
  if (!result.voice_id) throw new Error(`No voice_id returned. Response keys: ${Object.keys(result).join(', ')}`);
  store[agent].voice_id = result.voice_id; store[agent].picked = n; saveStore(store);
  setEnv(spec.env, result.voice_id);
  console.log(`${agent}: created "ADE ${spec.name}" and wrote ${spec.env} to .env`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const key = process.env.ELEVENLABS_API_KEY || readEnv().ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is missing from .env');
  const force = args.includes('--force');
  if (value('--pick')) return pick(value('--pick')!, key);
  const one = value('--agent') ?? value('--only');
  if (one) return design(one, key, force);
  if (args.includes('--all')) { for (const agent of ORDER) await design(agent, key, force); return; }
  console.log('Usage: --agent <id> | --all | --pick <id>=<n>   [--force]');
}
main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
