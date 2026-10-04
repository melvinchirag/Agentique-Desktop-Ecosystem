import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adeDataDir } from '../store/tiger';

export interface CachedClip { audio: ArrayBuffer; alignment?: object }

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/**
 * Spoken clips on disk, so a repeated line costs no credits and plays with no network delay
 * (docs/SPONSORS.md §3.5). Files: <dir>/<key>.mp3 and, when there is lip-sync data, <key>.json.
 */
export class VoiceCache {
  readonly dir: string;

  constructor(dir: string = join(adeDataDir(), 'voice-cache')) { this.dir = dir; }

  /** Same voice + model + mood + text → same clip. */
  key(voiceId: string, model: string, mood: string, text: string): string {
    return createHash('sha256').update([voiceId, model, mood, text].join('\u0000')).digest('hex');
  }

  get(key: string): CachedClip | null {
    const mp3 = join(this.dir, `${key}.mp3`);
    if (!existsSync(mp3)) return null;
    try {
      const audio = toArrayBuffer(readFileSync(mp3));
      const json = join(this.dir, `${key}.json`);
      return existsSync(json) ? { audio, alignment: JSON.parse(readFileSync(json, 'utf8')) } : { audio };
    } catch { return null; }                                // an unreadable entry is just a miss
  }

  set(key: string, clip: CachedClip): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, `${key}.mp3`), Buffer.from(clip.audio));
      if (clip.alignment) writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(clip.alignment));
    } catch { /* a full disk must not stop the animal from speaking */ }
  }
}
