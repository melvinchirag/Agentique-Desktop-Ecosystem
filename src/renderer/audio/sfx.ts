import type { CreateSfxPlayer } from '../shell/contracts';

type Sound = { id: string; file: string; loop?: boolean; volume?: number };

export const createSfxPlayer: CreateSfxPlayer = (opts = {}) => {
  const base = (opts.baseUrl ?? './sfx').replace(/\/$/, '');
  let enabled = true, ambienceEnabled = false, volume = 1, warned = false, disposed = false;
  let context: AudioContext | undefined;
  let master: GainNode | undefined;
  let ambience: AudioBufferSourceNode | undefined;
  let ambienceStarting = false;
  let manifest: Promise<Map<string, Sound> | null> | undefined;
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  const active = new Set<AudioBufferSourceNode>();
  const warn = () => { if (!warned) { warned = true; console.warn('SFX unavailable; continuing silently.'); } };
  const getContext = () => context ??= opts.audioContext?.() ?? new AudioContext();
  const sounds = () => manifest ??= fetch(`${base}/manifest.json`).then(async response => {
    if (!response.ok) throw new Error('manifest missing');
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('invalid manifest');
    return new Map((data as Sound[]).map(sound => [sound.id, sound]));
  }).catch(() => { warn(); return null; });
  const getBuffer = (id: string) => buffers.get(id) ?? (() => {
    const task = (async () => {
      try {
        const sound = (await sounds())?.get(id);
        if (!sound) return null;
        // Manifest paths are repository-relative; the served tree starts at resources/sfx.
        const file = sound.file.replace(/^resources\/sfx\//, '');
        const response = await fetch(`${base}/${file}`);
        if (!response.ok) throw new Error('sound missing');
        return await getContext().decodeAudioData(await response.arrayBuffer());
      } catch { warn(); return null; }
    })();
    buffers.set(id, task); return task;
  })();
  const stopAmbience = () => { if (ambience) { ambience.stop(); ambience.disconnect(); ambience = undefined; } };
  const start = async (id: string, loop: boolean) => {
    if (!enabled || disposed || (loop && !ambienceEnabled)) { if (loop) ambienceStarting = false; return; }
    const buffer = await getBuffer(id);
    if (!buffer || !enabled || disposed || (loop && !ambienceEnabled)) { if (loop) ambienceStarting = false; return; }
    if (!loop && active.size >= 2) return;
    try {
      const ac = getContext();
      if (ac.state === 'suspended') await ac.resume();
      if (disposed || !enabled || (loop && !ambienceEnabled) || (!loop && active.size >= 2)) return;
      const sound = (await sounds())?.get(id);
      if (disposed || !enabled || (loop && !ambienceEnabled) || (!loop && active.size >= 2)) return;
      if (!master) { master = ac.createGain(); master.connect(ac.destination); }
      master.gain.value = volume;
      const source = ac.createBufferSource();
      const gain = ac.createGain();
      source.buffer = buffer; source.loop = loop;
      gain.gain.value = loop ? 0.15 : sound?.volume ?? 1;
      source.connect(gain); gain.connect(master);
      if (loop) ambience = source;
      else { active.add(source); source.onended = () => { active.delete(source); source.disconnect(); gain.disconnect(); }; }
      source.start();
    } catch { warn(); }
    finally { if (loop) ambienceStarting = false; }
  };
  return {
    play(id) { if (id !== 'biome.forest-ambience') void start(id, false); },
    setVolume(value) { volume = Math.max(0, Math.min(1, value)); if (master) master.gain.value = volume; },
    setEnabled(on) { enabled = on; if (!on) { stopAmbience(); for (const source of active) source.stop(); active.clear(); } else if (ambienceEnabled && !ambience && !ambienceStarting) { ambienceStarting = true; void start('biome.forest-ambience', true); } },
    setAmbienceEnabled(on) { ambienceEnabled = on; if (on && enabled && !ambience && !ambienceStarting) { ambienceStarting = true; void start('biome.forest-ambience', true); } else if (!on) stopAmbience(); },
    dispose() { disposed = true; stopAmbience(); for (const source of active) source.stop(); active.clear(); },
  };
};
