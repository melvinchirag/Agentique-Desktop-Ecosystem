// Generates ADE's sound effects, biome ambience, and the Celene music test with ElevenLabs. Run once; files ship in resources/.
//   npx tsx scripts/generate-sfx.ts                  generate everything that is missing
//   npx tsx scripts/generate-sfx.ts --only chipmunk      one group
//   npx tsx scripts/generate-sfx.ts --music          also compose the Celene test track (paid plans only)
// Add --force to regenerate files that already exist.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SFX_DIR = join(ROOT, 'resources', 'sfx');
const MANIFEST = join(SFX_DIR, 'manifest.json');
const MUSIC_FILE = join(ROOT, 'resources', 'music', 'test-calm.mp3');
const API = 'https://api.elevenlabs.io/v1';
const SFX_MODEL = 'eleven_text_to_sound_v2';
const MUSIC_MODEL = 'music_v2_5';
const BITRATE = 128_000; // output_format mp3_44100_128

interface Sound { group: string; name: string; seconds: number; prompt: string; loop?: boolean }
const S = (group: string, name: string, seconds: number, prompt: string, loop = false): Sound => ({ group, name, seconds, prompt, loop });

// Sounds: docs/SPONSORS.md §3.4, plus one "poke" (clicked) reaction per animal. Groups are agent ids (plus system, biome).
const SOUNDS: Sound[] = [
  S('chipmunk', 'chirp', 1, 'tiny cartoon chipmunk chirp, cute, bright, short, clean, no background'),
  S('chipmunk', 'squeak', 1, 'small scared cartoon chipmunk squeak, high pitched, startled, short, clean'),
  S('chipmunk', 'happy-trill', 1.5, 'happy cartoon chipmunk trill, cheerful rising chitter, cute, clean'),
  S('chipmunk', 'knock-knock', 1.5, 'two quick light knocks on a glass window, playful, close, clean'),
  S('chipmunk', 'boing', 1, 'cartoon spring boing, bouncy, comedic, short, clean'),
  S('chipmunk', 'snore', 2.5, 'tiny cute cartoon animal snore, soft, small, sleepy, one breath in and out'),
  S('chipmunk', 'poke', 1.2, 'real chipmunk startled rapid chatter, fast high pitched chip-chip-chip rodent clicks, no voice, no music'),
  S('wolf', 'growl', 2, 'low wolf growl, deep, protective warning, close, clean, no background'),
  S('wolf', 'howl', 3, 'single wolf howl, clear, alert, noble, clean'),
  S('wolf', 'sniff', 1, 'wolf sniffing the air twice, close, short, clean'),
  S('wolf', 'poke', 1.2, 'one short deep gruff wolf bark, a low woof huff from a large canine, close, no growl, no howl'),
  S('beaver', 'tail-slap', 1, 'beaver tail slap on water, one sharp wet smack, clean'),
  S('beaver', 'wood-gnaw', 2, 'beaver gnawing on wood, quick crunchy chewing, close, clean'),
  S('beaver', 'log-thunk', 1, 'heavy wooden log dropped on a wooden pile, solid thunk, short'),
  S('beaver', 'wood-gnaw-loop', 4, 'beaver gnawing on wood continuously, steady crunchy chewing rhythm, close, clean, seamless', true),
  S('beaver', 'paper-rustle', 1.2, 'a sheet of paper being picked up and rustled, soft, close, clean'),
  S('beaver', 'reverse-whoosh', 1, 'reversed whoosh, airy sound sucking backwards, rewind feel, short, clean'),
  S('beaver', 'poke', 1.2, 'beaver low nasal grunt followed by one quick flat tail thump on a wooden log, natural animal sound'),
  S('eagle', 'screech', 1.5, 'eagle screech, sharp, clear, single call, clean, no background'),
  S('eagle', 'wing-flaps', 2, 'large bird wing flaps, three strong flaps taking off, close, clean'),
  S('eagle', 'whoosh', 1, 'fast airy whoosh passing by, swift flight, clean'),
  S('eagle', 'poke', 1.2, 'bald eagle short piping call, three quick high thin whistled notes, natural bird of prey, close'),
  S('ants', 'skitter', 1.5, 'tiny insect legs skittering quickly across a hard surface, light, many small ticks'),
  S('ants', 'marching-patter', 2.5, 'hundreds of tiny ants marching in rhythm, miniature footsteps patter, cute, steady'),
  S('ants', 'poke', 1.2, 'dozens of tiny dry insect clicks and ticks scattering quickly, miniature mandible clicking, no voices'),
  S('workspace', 'blip', 0.6, 'friendly digital blip, soft clean UI tone, single short note'),
  S('workspace', 'stamp', 1, 'rubber stamp pressed on paper, satisfying thud, short, clean'),
  S('workspace', 'poke', 1.2, 'friendly small robot double beep, two short clean synth tones boop-beep, digital assistant reacting'),
  S('butterfly', 'flutter-sparkle', 1.5, 'delicate butterfly wing flutter with a soft magical sparkle chime, light, airy'),
  S('butterfly', 'poke', 1.2, 'very soft rapid wing flutter burst then a single tiny glass chime twinkle, delicate, airy, no voice'),
  S('nightingale', 'trill', 2, 'nightingale bird song trill, melodic, sweet, clear, clean, no background'),
  S('nightingale', 'poke', 1.2, 'nightingale short melodic whistle phrase, four liquid flute-like rising notes, natural songbird'),
  S('system', 'scroll-pass', 1, 'paper scroll handed over, soft papery swish, short, clean'),
  S('system', 'pop', 0.6, 'soft bubbly pop, pleasant UI sound, single, clean'),
  S('system', 'dock-whoomp', 1, 'soft low whoomp, object settling into a dock, cushioned, short'),
  S('system', 'wake-chime', 1.5, 'gentle wake up chime, three soft rising bell notes, warm, magical'),
  S('system', 'approval-ding', 1, 'bright positive confirmation ding, single clean bell, friendly'),
  S('biome', 'forest-ambience', 25, 'calm forest ambience, gentle birdsong, a quiet stream, light wind in leaves, peaceful, seamless', true)
];
const MUSIC_PROMPT = 'A calm, warm instrumental piece for relaxing and focus: soft piano, gentle strings, a light flute melody like a nightingale, slow tempo, peaceful forest night mood.';

function apiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const path = join(ROOT, '.env');
  const line = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).find(l => l.startsWith('ELEVENLABS_API_KEY=')) : undefined;
  const key = line?.slice('ELEVENLABS_API_KEY='.length).trim().replace(/^"(.*)"$/, '$1');
  if (!key) throw new Error('ELEVENLABS_API_KEY is missing from .env');
  return key;
}
async function post(path: string, body: object, key: string): Promise<Buffer> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ElevenLabs ${path} returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return Buffer.from(await res.arrayBuffer());
}
const relFile = (s: Sound) => `resources/sfx/${s.group}/${s.name}.mp3`;
const durationMs = (bytes: number) => Math.round(bytes * 8 / BITRATE * 1000);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
  const key = apiKey();
  const todo = SOUNDS.filter(s => (!only || s.group === only) && (force || !existsSync(join(ROOT, relFile(s)))));
  console.log(`${todo.length} sound(s) to generate`);
  let failed = 0;
  const queue = [...todo];
  await Promise.all([0, 1, 2].map(async () => {            // concurrency 3
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const audio = await post('/sound-generation?output_format=mp3_44100_128',
          { text: s.prompt, model_id: SFX_MODEL, duration_seconds: s.seconds, ...(s.loop ? { loop: true } : {}) }, key);
        mkdirSync(join(SFX_DIR, s.group), { recursive: true });
        writeFileSync(join(ROOT, relFile(s)), audio);
        console.log(`ok    ${relFile(s)}`);
      } catch (e: any) { failed++; console.error(`FAIL  ${relFile(s)}  ${e.message}`); }
    }
  }));
  // The manifest always describes every file on disk, not only this run's.
  const manifest = SOUNDS.filter(s => existsSync(join(ROOT, relFile(s)))).map(s => ({
    id: `${s.group}.${s.name}`, file: relFile(s),
    durationMs: durationMs(readFileSync(join(ROOT, relFile(s))).length), prompt: s.prompt, ...(s.loop ? { loop: true } : {})
  }));
  mkdirSync(SFX_DIR, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: ${manifest.length} of ${SOUNDS.length} sounds`);

  if (args.includes('--music') && (force || !existsSync(MUSIC_FILE))) {
    try {
      const audio = await post('/music/compose?output_format=mp3_44100_128', { prompt: MUSIC_PROMPT, music_length_ms: 20_000, model_id: MUSIC_MODEL }, key);
      mkdirSync(dirname(MUSIC_FILE), { recursive: true });
      writeFileSync(MUSIC_FILE, audio);
      console.log('ok    resources/music/test-calm.mp3');
    } catch (e: any) { failed++; console.error(`FAIL  music  ${e.message}`); }
  }
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
