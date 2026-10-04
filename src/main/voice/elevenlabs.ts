import type { AgentId, AgentMood } from '../../shared/agents';
import type { VoiceService } from '../runtime/types';
import { VoiceCache, type CachedClip } from './cache';
import { moodVoice, tagPrefix } from './moodVoice';

const API = 'https://api.elevenlabs.io/v1';
const TTS_MODEL = 'eleven_v4_turbo';            // ~100 ms, supports audio tags
const FALLBACK_MODEL = 'eleven_flash_v2_5';     // no tags
const STT_MODEL = 'scribe_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const PREGENERATE_CONCURRENCY = 3;

/** Character timing for lip-sync and bubble timing. Covers the spoken text only (the mood tag is removed). */
export interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }

export interface ElevenLabsVoiceOptions {
  apiKey: string;
  /** agent id → ElevenLabs voice id (EL_VOICE_*). */
  voiceIds: Partial<Record<AgentId, string>>;
  /** settings.voiceEnabled. When false, speak() returns an empty clip and spends no credits. */
  voiceEnabled?: () => boolean;
  cache?: VoiceCache;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

const EMPTY: CachedClip = { audio: new ArrayBuffer(0) };
const EXTENSIONS: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' };

/** Drop the first `count` characters (the mood tag and its space) from a with-timestamps alignment. */
export function stripAlignmentPrefix(alignment: Alignment | undefined | null, count: number): Alignment | undefined {
  if (!alignment?.characters) return undefined;
  return {
    characters: alignment.characters.slice(count),
    character_start_times_seconds: alignment.character_start_times_seconds.slice(count),
    character_end_times_seconds: alignment.character_end_times_seconds.slice(count),
  };
}

/**
 * The real VoiceService: every animal speaks and hears through here (docs/SPONSORS.md Part 3).
 * Endpoints and shapes were confirmed with real calls: docs/sponsor-verify.md §E1–E4.
 */
export class ElevenLabsVoice implements VoiceService {
  private readonly apiKey: string;
  private readonly voiceIds: Partial<Record<AgentId, string>>;
  private readonly voiceEnabled: () => boolean;
  private readonly cache: VoiceCache;
  private readonly fetchFn: typeof fetch;
  private readonly log: (message: string) => void;

  constructor(opts: ElevenLabsVoiceOptions) {
    if (!opts.apiKey) throw new Error('ELEVENLABS_API_KEY is missing');
    this.apiKey = opts.apiKey;
    this.voiceIds = opts.voiceIds;
    this.voiceEnabled = opts.voiceEnabled ?? (() => true);
    this.cache = opts.cache ?? new VoiceCache();
    this.fetchFn = opts.fetch ?? fetch;
    this.log = opts.log ?? ((m) => console.warn(`[voice] ${m}`));
  }

  /** One spoken line in the animal's voice, coloured by its mood. A repeated line comes from the cache. */
  async speak(agentId: AgentId, text: string, mood: AgentMood): Promise<{ audio: ArrayBuffer; alignment?: object }> {
    const line = text.trim();
    if (!this.voiceEnabled() || !line) return EMPTY;
    const voiceId = this.voiceIds[agentId];
    if (!voiceId) throw new Error(`No ElevenLabs voice for "${agentId}". Run scripts/design-voices.ts (EL_VOICE_${agentId.toUpperCase()}).`);

    const key = this.cache.key(voiceId, TTS_MODEL, mood, line);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const { stability, style, speed } = moodVoice(mood);
    const settings = { stability, style, speed };
    const prefix = tagPrefix(mood);
    try {
      const clip = await this.tts(voiceId, TTS_MODEL, prefix + line, settings, prefix.length);
      this.cache.set(key, clip);
      return clip;
    } catch (err) {
      // v4 turbo failed: say it anyway, without the tag. Not cached, so the tagged version is tried again next time.
      this.log(`${TTS_MODEL} failed (${(err as Error).message.slice(0, 200)}); using ${FALLBACK_MODEL}`);
      return this.tts(voiceId, FALLBACK_MODEL, line, settings, 0);
    }
  }

  /** Fills the cache (acks, greetings, Warden's template lines) so they play instantly. Failures are logged, not thrown. */
  async pregenerate(lines: { agentId: AgentId; text: string; mood?: AgentMood }[]): Promise<void> {
    const queue = [...lines];
    await Promise.all(Array.from({ length: PREGENERATE_CONCURRENCY }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try { await this.speak(next.agentId, next.text, next.mood ?? 'neutral'); }
        catch (err) { this.log(`pregenerate failed for ${next.agentId}: ${(err as Error).message.slice(0, 200)}`); }
      }
    }));
  }

  /** Speech to text. `cues` are the non-speech sounds the model heard, e.g. "(sighs)", "(laughter)": Chip reads mood from them. */
  async transcribe(audio: ArrayBuffer, mime: string): Promise<{ text: string; cues: string[] }> {
    const type = mime.split(';')[0]!.trim() || 'audio/webm';
    const form = new FormData();
    form.set('file', new Blob([audio], { type }), `speech.${EXTENSIONS[type] ?? 'webm'}`);
    form.set('model_id', STT_MODEL);
    form.set('tag_audio_events', 'true');
    const res = await this.fetchFn(`${API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': this.apiKey }, body: form });
    if (!res.ok) throw new Error(`ElevenLabs speech-to-text returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const result = (await res.json()) as { text?: string; words?: { text: string; type: string }[] };
    const words = result.words ?? [];
    const cues = words.filter((w) => w.type === 'audio_event').map((w) => w.text);
    const spoken = words.length
      ? words.filter((w) => w.type !== 'audio_event').map((w) => w.text).join('')
      : (result.text ?? '');
    return { text: spoken.replace(/\s+/g, ' ').trim(), cues };
  }

  private async tts(voiceId: string, model: string, text: string, settings: object, prefixLength: number): Promise<CachedClip> {
    const res = await this.fetchFn(`${API}/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model, voice_settings: settings }),
    });
    if (!res.ok) throw new Error(`ElevenLabs text-to-speech returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { audio_base64?: string; alignment?: Alignment | null };
    if (!body.audio_base64) throw new Error('ElevenLabs text-to-speech returned no audio');
    const buf = Buffer.from(body.audio_base64, 'base64');
    const audio = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const alignment = stripAlignmentPrefix(body.alignment, prefixLength);
    return alignment ? { audio, alignment } : { audio };
  }
}
