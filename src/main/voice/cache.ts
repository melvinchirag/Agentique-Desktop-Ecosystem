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

/**
 * Lines rendered at build time and shipped with the app: resources/voice-lines/<agent>/manifest.json
 * (written by scripts/pregen-lines.ts). Looked up by exact text. Playing one costs no API call.
 */
export class ShippedLines {
  private readonly byAgent = new Map<string, Map<string, { file: string; alignment?: string }> | null>();

  constructor(readonly dir: string = join(process.cwd(), 'resources', 'voice-lines')) {}

  get(agentId: string, text: string): CachedClip | null {
    const entry = this.index(agentId)?.get(text.trim());
    if (!entry) return null;
    try {
      const base = join(this.dir, agentId);
      const audio = toArrayBuffer(readFileSync(join(base, entry.file)));
      const timing = entry.alignment && existsSync(join(base, entry.alignment)) ? JSON.parse(readFileSync(join(base, entry.alignment), 'utf8')) : null;
      return timing ? { audio, alignment: timing } : { audio };
    } catch { return null; }                                // a missing or broken file is just a miss
  }

  private index(agentId: string): Map<string, { file: string; alignment?: string }> | null {
    if (!this.byAgent.has(agentId)) {
      let map: Map<string, { file: string; alignment?: string }> | null = null;
      try {
        const manifest = JSON.parse(readFileSync(join(this.dir, agentId, 'manifest.json'), 'utf8')) as { lines?: { text: string; file: string; alignment?: string }[] };
        map = new Map((manifest.lines ?? []).map((l) => [l.text.trim(), { file: l.file, alignment: l.alignment }]));
      } catch { /* no shipped lines for this animal */ }
      this.byAgent.set(agentId, map);
    }
    return this.byAgent.get(agentId) ?? null;
  }
}
