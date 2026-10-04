import type { CreateSfxPlayer } from '../shell/contracts';

type Sound = { file: string; volume?: number };
export const createSfxPlayer: CreateSfxPlayer = (opts = {}) => {
  const base = opts.baseUrl ?? ''; let enabled = true, volume = 1, warned = false;
  let manifest: Promise<Record<string, Sound> | null> | undefined;
  let audioContext: AudioContext | undefined;
  const getContext = () => audioContext ??= opts.audioContext?.() ?? new AudioContext();
  const cache = new Map<string, Promise<AudioBuffer | null>>();
  let master: GainNode | undefined;
  const warn = () => { if (!warned) { warned = true; console.warn('SFX unavailable; continuing silently.'); } };
  const loadManifest = () => manifest ??= fetch(`${base.replace(/\/$/, '')}/manifest.json`).then(async r => {
    if (!r.ok) throw new Error('manifest missing'); const data = await r.json() as { version?: number; sounds?: Record<string, Sound> };
    if (data.version !== 1 || !data.sounds) throw new Error('invalid manifest'); return data.sounds;
  }).catch(() => { warn(); return null; });
  const getBuffer = (name: string) => cache.get(name) ?? (() => {
    const task = (async () => {
      try {
        const sounds = await loadManifest(), sound = sounds?.[name]; if (!sound) { warn(); return null; }
        const response = await fetch(`${base.replace(/\/$/, '')}/${sound.file.replace(/^\//, '')}`); if (!response.ok) throw new Error('sound missing');
        const ac = getContext(); return await ac.decodeAudioData(await response.arrayBuffer());
      } catch { warn(); return null; }
    })(); cache.set(name, task); return task;
  })();
  return {
    async play(name: string) {
      if (!enabled) return;
      const buffer = await getBuffer(name); if (!buffer || !enabled) return;
      try { const ac = getContext(); if (ac.state === 'suspended') await ac.resume();
        if (!master || master.context !== ac) { master = ac.createGain(); master.connect(ac.destination); }
        master.gain.value = volume; const sounds = await loadManifest(), source = ac.createBufferSource(), gain = ac.createGain();
        source.buffer = buffer; gain.gain.value = sounds?.[name]?.volume ?? 1; source.connect(gain); gain.connect(master); source.start();
      } catch { warn(); }
    },
    setVolume(v: number) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },
    setEnabled(on: boolean) { enabled = on; },
  };
};
