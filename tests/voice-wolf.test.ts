import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ShippedLines, VoiceCache } from '../src/main/voice/cache';
import { ElevenLabsVoice } from '../src/main/voice/elevenlabs';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ade-wolf-')); dirs.push(d); return d; };
const text = (b: ArrayBuffer) => Buffer.from(b).toString();

function setup(opts: { shipped?: boolean; voiceEnabled?: boolean } = {}) {
  const calls: any[] = [];
  const linesDir = tmp();
  if (opts.shipped !== false) {
    mkdirSync(join(linesDir, 'wolf'));
    writeFileSync(join(linesDir, 'wolf', 'deny-w1-send.mp3'), 'SHIPPED-MP3');
    writeFileSync(join(linesDir, 'wolf', 'deny-w1-send.json'), JSON.stringify({ characters: ['I'], character_start_times_seconds: [0.4], character_end_times_seconds: [0.5] }));
    writeFileSync(join(linesDir, 'wolf', 'manifest.json'), JSON.stringify({ agent: 'wolf', lines: [
      { trigger: 'deny-w1-send', text: "I never send. It's in your drafts.", file: 'deny-w1-send.mp3', alignment: 'deny-w1-send.json', hash: 'x' },
      { trigger: 'gone', text: 'Missing file.', file: 'gone.mp3', alignment: 'gone.json', hash: 'y' }] }));
  }
  const fetchFn = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify({ audio_base64: Buffer.from('LIVE:' + body.text).toString('base64'), alignment: null }), { status: 200 });
  }) as typeof fetch;
  const voice = new ElevenLabsVoice({ apiKey: 'k', voiceIds: { wolf: 'voice-warden', chipmunk: 'voice-chip' }, cache: new VoiceCache(tmp()),
    shipped: new ShippedLines(linesDir), fetch: fetchFn, voiceEnabled: () => opts.voiceEnabled ?? true, log: () => {} });
  return { voice, calls };
}

describe("speak('wolf', …)", () => {
  it('returns the shipped mp3 with no API call, whatever the mood', async () => {
    const { voice, calls } = setup();
    for (const mood of ['proud', 'scared', 'neutral'] as const) {
      const clip = await voice.speak('wolf', "I never send. It's in your drafts.", mood);
      expect(text(clip.audio)).toBe('SHIPPED-MP3');
      expect((clip.alignment as any).character_start_times_seconds).toEqual([0.4]);
    }
    expect(calls).toHaveLength(0);
  });

  it('ignores surrounding whitespace when matching a shipped line', async () => {
    const { voice, calls } = setup();
    expect(text((await voice.speak('wolf', "  I never send. It's in your drafts. ", 'happy')).audio)).toBe('SHIPPED-MP3');
    expect(calls).toHaveLength(0);
  });

  it('a line that is not shipped is rendered live, always [serious] with the protective settings', async () => {
    const { voice, calls } = setup();
    await voice.speak('wolf', 'Thirty-seven files? Your call.', 'excited');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/text-to-speech/voice-warden/');
    expect(calls[0].body).toEqual({ text: '[serious] Thirty-seven files? Your call.', model_id: 'eleven_v4_turbo', voice_settings: { stability: 0.8, style: 0.3, speed: 0.95 } });
  });

  it('a live line is cached once for every mood (the mood is ignored)', async () => {
    const { voice, calls } = setup();
    await voice.speak('wolf', 'Custom line.', 'excited');
    await voice.speak('wolf', 'Custom line.', 'sad');
    expect(calls).toHaveLength(1);
  });

  it('a manifest entry whose file is missing falls back to a live render', async () => {
    const { voice, calls } = setup();
    expect(text((await voice.speak('wolf', 'Missing file.', 'neutral')).audio)).toBe('LIVE:[serious] Missing file.');
    expect(calls).toHaveLength(1);
  });

  it('works with no shipped lines at all', async () => {
    const { voice, calls } = setup({ shipped: false });
    await voice.speak('wolf', "I never send. It's in your drafts.", 'neutral');
    expect(calls).toHaveLength(1);
  });

  it('voiceEnabled = false stays silent even for shipped lines', async () => {
    const { voice } = setup({ voiceEnabled: false });
    expect((await voice.speak('wolf', "I never send. It's in your drafts.", 'neutral')).audio.byteLength).toBe(0);
  });

  it('another animal with shipped lines plays its own, and falls back to a live render for other text', async () => {
    const { voice, calls } = setup();
    const dir = (voice as any).shipped.dir as string;
    mkdirSync(join(dir, 'ants'));
    writeFileSync(join(dir, 'ants', 'plan-assembled.mp3'), 'ANTS-MP3');
    writeFileSync(join(dir, 'ants', 'manifest.json'), JSON.stringify({ agent: 'ants', lines: [{ trigger: 'plan-assembled', text: 'Plan assembled!', file: 'plan-assembled.mp3', hash: 'z' }] }));
    const custom = new ElevenLabsVoice({ apiKey: 'k', voiceIds: { ants: 'voice-swarm' }, cache: new VoiceCache(tmp()), shipped: new ShippedLines(dir),
      fetch: (async (url: any, init: any) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ audio_base64: Buffer.from('LIVE').toString('base64'), alignment: null }), { status: 200 }); }) as typeof fetch, log: () => {} });
    expect(text((await custom.speak('ants', 'Plan assembled!', 'excited')).audio)).toBe('ANTS-MP3');
    expect(calls).toHaveLength(0);
    await custom.speak('ants', 'Step two, on its way!', 'excited');
    expect(calls).toHaveLength(1);
    expect(calls[0].body.text).toBe('[excited] Step two, on its way!');       // mood kept for non-Warden animals
  });

  it('other animals keep their mood and never read Warden\'s shipped lines', async () => {
    const { voice, calls } = setup();
    await voice.speak('chipmunk', "I never send. It's in your drafts.", 'excited');
    expect(calls[0].body.text).toBe("[excited] I never send. It's in your drafts.");
  });

  it('pregenerate with Warden\'s shipped lines spends nothing', async () => {
    const { voice, calls } = setup();
    await voice.pregenerate([{ agentId: 'wolf', text: "I never send. It's in your drafts." }]);
    expect(calls).toHaveLength(0);
  });
});

describe('the lines shipped in the repo', () => {
  it('every manifest line has its mp3 and timing file, and plays with no API call', async () => {
    const shipped = new ShippedLines(join(__dirname, '..', 'resources', 'voice-lines'));
    const manifest = (await import('../resources/voice-lines/wolf/manifest.json')).default as { lines: { text: string; trigger: string }[] };
    expect(manifest.lines.length).toBeGreaterThanOrEqual(16);
    for (const line of manifest.lines) {
      const clip = shipped.get('wolf', line.text);
      expect(clip, line.trigger).not.toBeNull();
      expect(clip!.audio.byteLength).toBeGreaterThan(2000);
      expect((clip!.alignment as any).characters.join('')).toBe(line.text);
    }
  });
});
