import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentMood } from '../src/shared/agents';
import { VoiceCache } from '../src/main/voice/cache';
import { ElevenLabsVoice, stripAlignmentPrefix } from '../src/main/voice/elevenlabs';
import { MOOD_VOICE, tagPrefix } from '../src/main/voice/moodVoice';

type Call = { url: string; body: any; form?: FormData };
type Reply = { status?: number; json?: unknown };

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const alignmentFor = (text: string) => ({
  characters: [...text], character_start_times_seconds: [...text].map((_, i) => i / 10), character_end_times_seconds: [...text].map((_, i) => (i + 1) / 10) });

function setup(replies: Reply[] | ((call: Call) => Reply), opts: { voiceEnabled?: boolean } = {}) {
  const calls: Call[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'ade-voice-'));
  dirs.push(dir);
  const fetchFn = (async (url: any, init: any) => {
    const call: Call = init.body instanceof FormData ? { url: String(url), body: null, form: init.body } : { url: String(url), body: JSON.parse(init.body) };
    calls.push(call);
    const reply = typeof replies === 'function' ? replies(call) : replies.shift();
    if (!reply) throw new Error('no reply scripted');
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  const voice = new ElevenLabsVoice({ apiKey: 'k', voiceIds: { chipmunk: 'voice-chip', beaver: 'voice-archie' }, cache: new VoiceCache(dir), fetch: fetchFn,
    voiceEnabled: () => opts.voiceEnabled ?? true, log: () => {} });
  return { voice, calls, dir };
}
const ttsOk = (call: Call): Reply => ({ json: { audio_base64: Buffer.from('mp3:' + call.body.text).toString('base64'), alignment: alignmentFor(call.body.text) } });
const text = (b: ArrayBuffer) => Buffer.from(b).toString();

describe('mood → voice table', () => {
  it('matches SPONSORS §3.3', () => {
    expect(MOOD_VOICE.excited).toEqual({ tag: '[excited]', stability: 0.3, style: 0.7, speed: 1.08 });
    expect(MOOD_VOICE.sad).toEqual({ tag: '[sad]', stability: 0.65, style: 0.3, speed: 0.92 });
    expect(MOOD_VOICE.protective).toEqual({ tag: '[serious]', stability: 0.8, style: 0.3, speed: 0.95 });
    expect(MOOD_VOICE.neutral.tag).toBe('');
    expect(tagPrefix('happy')).toBe('[cheerful] ');
    expect(tagPrefix('neutral')).toBe('');
  });
  it('covers every AgentMood', () => {
    const moods: AgentMood[] = ['neutral', 'happy', 'excited', 'proud', 'nervous', 'scared', 'sad', 'protective', 'sleepy', 'relieved'];
    for (const m of moods) expect(MOOD_VOICE[m]).toBeDefined();
  });
});

describe('speak', () => {
  it('sends v4 turbo with the mood tag and settings, to the timestamps endpoint', async () => {
    const { voice, calls } = setup(ttsOk);
    await voice.speak('chipmunk', 'On it!', 'excited');
    expect(calls[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-chip/with-timestamps?output_format=mp3_44100_128');
    expect(calls[0]!.body).toEqual({ text: '[excited] On it!', model_id: 'eleven_v4_turbo', voice_settings: { stability: 0.3, style: 0.7, speed: 1.08 } });
  });

  it('neutral sends no tag', async () => {
    const { voice, calls } = setup(ttsOk);
    await voice.speak('chipmunk', 'Hello.', 'neutral');
    expect(calls[0]!.body.text).toBe('Hello.');
  });

  it('returns audio and an alignment that covers only the spoken text', async () => {
    const { voice } = setup(ttsOk);
    const clip = await voice.speak('chipmunk', 'On it!', 'excited');
    expect(text(clip.audio)).toBe('mp3:[excited] On it!');
    const a = clip.alignment as any;
    expect(a.characters.join('')).toBe('On it!');
    expect(a.character_start_times_seconds).toHaveLength(6);
    expect(a.character_start_times_seconds[0]).toBeCloseTo(1.0);          // first spoken character, after the 10-character tag
  });

  it('a cache hit makes no API call and returns the same clip', async () => {
    const { voice, calls, dir } = setup(ttsOk);
    const first = await voice.speak('chipmunk', 'On it!', 'excited');
    const second = await voice.speak('chipmunk', 'On it!', 'excited');
    expect(calls).toHaveLength(1);
    expect(text(second.audio)).toBe(text(first.audio));
    expect(second.alignment).toEqual(first.alignment);
    expect(readdirSync(dir).sort().map((f) => f.split('.')[1])).toEqual(['json', 'mp3']);
  });

  it('a different mood, text, or animal is a different clip', async () => {
    const { voice, calls } = setup(ttsOk);
    await voice.speak('chipmunk', 'On it!', 'excited');
    await voice.speak('chipmunk', 'On it!', 'sad');
    await voice.speak('chipmunk', 'On it.', 'excited');
    await voice.speak('beaver', 'On it!', 'excited');
    expect(calls).toHaveLength(4);
  });

  it('falls back to flash without the tag when v4 turbo errors, and does not cache the fallback', async () => {
    const { voice, calls } = setup((call) => (call.body.model_id === 'eleven_v4_turbo' ? { status: 500, json: { detail: 'boom' } } : ttsOk(call)));
    const clip = await voice.speak('chipmunk', 'On it!', 'excited');
    expect(calls.map((c) => c.body.model_id)).toEqual(['eleven_v4_turbo', 'eleven_flash_v2_5']);
    expect(calls[1]!.body.text).toBe('On it!');
    expect(text(clip.audio)).toBe('mp3:On it!');
    await voice.speak('chipmunk', 'On it!', 'excited');
    expect(calls).toHaveLength(4);                                        // tried v4 turbo again
  });

  it('throws when both models fail', async () => {
    const { voice } = setup(() => ({ status: 401, json: { detail: 'bad key' } }));
    await expect(voice.speak('chipmunk', 'Hi', 'neutral')).rejects.toThrow(/401/);
  });

  it('voiceEnabled = false returns an empty clip and spends nothing', async () => {
    const { voice, calls } = setup(ttsOk, { voiceEnabled: false });
    const clip = await voice.speak('chipmunk', 'On it!', 'excited');
    expect(clip.audio.byteLength).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('an animal without a voice gives a clear error', async () => {
    const { voice } = setup(ttsOk);
    await expect(voice.speak('wolf', 'Halt.', 'protective')).rejects.toThrow(/EL_VOICE_WOLF/);
  });
});

describe('pregenerate', () => {
  it('fills the cache, defaults to neutral, and survives a failing line', async () => {
    const { voice, calls } = setup((call) => (call.url.includes('voice-archie') ? { status: 500 } : ttsOk(call)));
    await voice.pregenerate([{ agentId: 'chipmunk', text: 'On it!' }, { agentId: 'beaver', text: 'Dam.' }, { agentId: 'chipmunk', text: 'Got it!', mood: 'happy' }, { agentId: 'wolf', text: 'No.' }]);
    const before = calls.length;
    await voice.speak('chipmunk', 'On it!', 'neutral');
    await voice.speak('chipmunk', 'Got it!', 'happy');
    expect(calls.length).toBe(before);                                    // both came from the cache
  });
});

describe('transcribe', () => {
  it('posts the file to scribe_v2 with audio-event tagging', async () => {
    const { voice, calls } = setup([{ json: { text: '', words: [] } }]);
    await voice.transcribe(new ArrayBuffer(4), 'audio/webm;codecs=opus');
    const form = calls[0]!.form!;
    expect(calls[0]!.url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('tag_audio_events')).toBe('true');
    expect((form.get('file') as File).name).toBe('speech.webm');
    expect((form.get('file') as File).type).toBe('audio/webm');
  });

  it('removes audio events from the text and returns them as cues', async () => {
    const { voice } = setup([{ json: { text: '(sighs) Nothing works today. (laughter)', words: [
      { text: '(sighs)', type: 'audio_event' }, { text: ' ', type: 'spacing' }, { text: 'Nothing', type: 'word' }, { text: ' ', type: 'spacing' },
      { text: 'works', type: 'word' }, { text: ' ', type: 'spacing' }, { text: 'today.', type: 'word' }, { text: ' ', type: 'spacing' }, { text: '(laughter)', type: 'audio_event' }] } }]);
    expect(await voice.transcribe(new ArrayBuffer(4), 'audio/wav')).toEqual({ text: 'Nothing works today.', cues: ['(sighs)', '(laughter)'] });
  });

  it('throws with the status on an API error', async () => {
    const { voice } = setup([{ status: 400, json: { detail: 'invalid_audio' } }]);
    await expect(voice.transcribe(new ArrayBuffer(4), 'audio/webm')).rejects.toThrow(/400/);
  });
});

describe('stripAlignmentPrefix', () => {
  it('drops the tag characters and keeps the arrays the same length', () => {
    const a = stripAlignmentPrefix(alignmentFor('[sad] Oh.'), 6)!;
    expect(a.characters.join('')).toBe('Oh.');
    expect(a.character_end_times_seconds).toHaveLength(3);
  });
  it('no alignment → undefined', () => {
    expect(stripAlignmentPrefix(null, 3)).toBeUndefined();
  });
});
