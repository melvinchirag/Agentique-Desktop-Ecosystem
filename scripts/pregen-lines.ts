// Renders an animal's fixed template lines once and ships them as mp3s (03-warden-security.md §7).
//   npx tsx scripts/pregen-lines.ts --agent wolf          render the lines that are missing or whose text changed
//   npx tsx scripts/pregen-lines.ts --agent wolf --force  render all of them again
// Output: resources/voice-lines/<agent>/<trigger>.mp3 (+ <trigger>.json lip-sync timing) and manifest.json.
// The app plays these with no API call, so they work offline and cost no credits.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvFile, voiceIdsFromEnv } from '../src/main/sponsors/env';
import { stripAlignmentPrefix, type Alignment } from '../src/main/voice/elevenlabs';
import { moodVoice } from '../src/main/voice/moodVoice';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_v4_turbo';

interface Line { trigger: string; text: string; growl?: boolean }

// Warden's lines: the table in 03-warden-security.md §7. Replace with allWardenLines() once Melvin's lane L is merged.
// `growl` adds a short wolf growl before the line (blocks and alerts only), so he sounds like a wolf, not a guard.
const LINES: Record<string, Line[]> = {
  wolf: [
    { trigger: 'ask',               text: 'Need your OK on this one.' },
    { trigger: 'ask-big-batch',     text: "That's a big batch. Your call." },
    { trigger: 'approved',          text: 'Go ahead.' },
    { trigger: 'declined',          text: 'Understood. Standing down.' },
    { trigger: 'timeout',           text: 'No answer, so no.' },
    { trigger: 'deny-w1-send',      text: "I never send. It's in your drafts.", growl: true },
    { trigger: 'deny-w1-share',     text: 'Sharing and buying are your call, not mine.', growl: true },
    { trigger: 'deny-w5',           text: "That's outside your safe folders.", growl: true },
    { trigger: 'deny-w7',           text: 'No programs. Not on my watch.', growl: true },
    { trigger: 'deny-w9',           text: 'Stop. We already tried that.', growl: true },
    { trigger: 'deny-not-your-tool', text: 'Not your tool. Blocked.', growl: true },
    { trigger: 'deny-w12',          text: "That link's not safe to open.", growl: true },
    { trigger: 'deny-w13',          text: "Can't attach that file.", growl: true },
    { trigger: 'deny-w0',           text: "Something's off. Blocking to be safe.", growl: true },
    { trigger: 'alert-injection',   text: "Trick spotted. I've got it.", growl: true },
    { trigger: 'app-start',         text: 'Warden on watch.' },
  ],
};
// Warden is always serious, whatever the biome's mood.
const DELIVERY: Record<string, { tag: string; growlTag: string; stability: number; style: number; speed: number }> = {
  wolf: { tag: '[serious] ', growlTag: '[growls] [serious] ', ...pick(moodVoice('protective')) },
};
function pick(m: { stability: number; style: number; speed: number }) { return { stability: m.stability, style: m.style, speed: m.speed }; }

interface ManifestLine { trigger: string; text: string; file: string; alignment: string; hash: string }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const agent = args.includes('--agent') ? args[args.indexOf('--agent') + 1]! : '';
  const lines = LINES[agent];
  const delivery = DELIVERY[agent];
  if (!lines || !delivery) throw new Error(`Usage: --agent <${Object.keys(LINES).join('|')}> [--force]`);
  const force = args.includes('--force');
  const env = { ...readEnvFile(join(ROOT, '.env')), ...process.env };
  const voiceId = voiceIdsFromEnv(env)[agent as 'wolf'];
  if (!env.ELEVENLABS_API_KEY || !voiceId) throw new Error(`ELEVENLABS_API_KEY or EL_VOICE_${agent.toUpperCase()} is missing from .env`);

  const dir = join(ROOT, 'resources', 'voice-lines', agent);
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const old: ManifestLine[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).lines ?? [] : [];
  const manifest: ManifestLine[] = [];

  for (const line of lines) {
    const prefix = line.growl ? delivery.growlTag : delivery.tag;
    const hash = createHash('sha256').update([voiceId, MODEL, prefix, line.text].join('\u0000')).digest('hex').slice(0, 16);
    const entry: ManifestLine = { trigger: line.trigger, text: line.text, file: `${line.trigger}.mp3`, alignment: `${line.trigger}.json`, hash };
    manifest.push(entry);
    const unchanged = old.find((o) => o.trigger === line.trigger)?.hash === hash && existsSync(join(dir, entry.file));
    if (unchanged && !force) { console.log(`skip  ${entry.file}`); continue; }
    const res = await fetch(`${API}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prefix + line.text, model_id: MODEL, voice_settings: { stability: delivery.stability, style: delivery.style, speed: delivery.speed } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs returned ${res.status} for "${line.trigger}": ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { audio_base64: string; alignment?: Alignment };
    writeFileSync(join(dir, entry.file), Buffer.from(body.audio_base64, 'base64'));
    writeFileSync(join(dir, entry.alignment), JSON.stringify(stripAlignmentPrefix(body.alignment, prefix.length) ?? null));
    console.log(`ok    ${entry.file}  "${line.text}"`);
  }
  writeFileSync(manifestPath, JSON.stringify({ agent, model: MODEL, lines: manifest }, null, 2) + '\n');
  console.log(`manifest: ${manifest.length} lines`);
}
main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
