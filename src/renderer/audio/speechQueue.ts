import type { SpeechItem, SpeechOutcome, SpeechQueue, SpeechQueueDeps } from '../shell/contracts';
import type { Clock } from '../../main/runtime/types';

type Entry = { item: SpeechItem; at: number; bytes?: ArrayBuffer; error?: unknown; ready: boolean; expiry?: unknown; done?: (outcome: SpeechOutcome) => void };
const rank = { warden: 0, chip: 1, report: 2, ack: 3 } as const;
let sharedContext: AudioContext | undefined;
const context = () => sharedContext ??= new AudioContext();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createSpeechQueue(deps: SpeechQueueDeps): SpeechQueue {
  const clock: Clock = deps.clock ?? { now: Date.now, setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: h => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>) };
  let enabled = true, disposed = false, active: Entry | null = null, volume = 1, inflight = 0;
  let generation = 0;
  let stopTicker: (() => void) | undefined;
  const queue: Entry[] = [];
  const starts = new Set<(item: SpeechItem) => void>(), ends = new Set<(item: SpeechItem, outcome: SpeechOutcome) => void>();
  const ctx = () => deps.audioContext?.() ?? context();
  const emitEnd = (e: Entry, result: SpeechOutcome) => { for (const cb of ends) cb(e.item, result); };
  const remove = (e: Entry) => { const i = queue.indexOf(e); if (i >= 0) queue.splice(i, 1); if (e.expiry !== undefined) clock.clearTimeout(e.expiry); };
  let finishCurrent: ((result: SpeechOutcome) => void) | undefined;
  let master: GainNode | undefined;
  const getMaster = (ac: AudioContext) => { if (!master || master.context !== ac) { master = ac.createGain(); master.gain.value = volume; master.connect(ac.destination); } return master; };
  const pump = () => {
    if (disposed || !enabled || active) return;
    for (const e of [...queue]) if (e.item.priority !== 'warden' && e.item.priority !== 'chip' && clock.now() - e.at >= 8000) { remove(e); e.done?.('dropped'); emitEnd(e, 'dropped'); }
    if (!queue.length) return;
    queue.sort((a, b) => rank[a.item.priority] - rank[b.item.priority] || a.at - b.at);
    const next = queue[0];
    if (queue.some(e => !e.ready && rank[e.item.priority] < rank[next.item.priority])) return;
    if (!next.ready) return;
    remove(next); active = next;
    const token = ++generation;
    const end = (outcome: SpeechOutcome) => {
      if (active !== next || token !== generation) return;
      stopTicker?.(); stopTicker = undefined;
      active = null; finishCurrent = undefined; deps.setMouth(next.item.agentId, 0); next.done?.(outcome); emitEnd(next, outcome); pump();
    };
    finishCurrent = end;
    for (const cb of starts) cb(next.item);
    const play = async () => {
      let ac: AudioContext;
      try { ac = ctx(); if (ac.state === 'suspended') await ac.resume(); }
      catch { end('failed'); return; }
      let buffer: AudioBuffer | null = null;
      try { if (next.bytes?.byteLength) buffer = await ac.decodeAudioData(next.bytes.slice(0)); } catch { /* silence fallback */ }
      if (active !== next || token !== generation) return;
      if (!buffer || buffer.duration <= 0) {
        const duration = clamp(60 * next.item.text.length, 800, 4000), started = Date.now();
        const interval = globalThis.setInterval(() => { if (active !== next || token !== generation) { globalThis.clearInterval(interval); return; } const elapsed = Date.now() - started; deps.setMouth(next.item.agentId, 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(elapsed * Math.PI * 2 / 125))); if (elapsed >= duration) { globalThis.clearInterval(interval); end('played'); } }, 34);
        stopTicker = () => globalThis.clearInterval(interval);
        return;
      }
      try {
        const output = getMaster(ac), analyser = ac.createAnalyser(); analyser.fftSize = 256;
        const localGain = ac.createGain(); localGain.gain.value = 1; localGain.connect(analyser); analyser.connect(output);
        const data = new Uint8Array(analyser.fftSize), sources: AudioBufferSourceNode[] = [];
        const chorus = next.item.agentId === 'ants';
        for (let i = 0; i < (chorus ? 3 : 1); i++) {
          const source = ac.createBufferSource(); source.buffer = buffer; if (chorus) source.detune.value = [0, 25, -25][i];
          const gain = ac.createGain(); gain.gain.value = chorus ? 0.6 : 1; source.connect(gain); gain.connect(localGain); sources.push(source);
          source.onended = () => { if (i === (chorus ? 2 : 0)) end('played'); };
          source.start(ac.currentTime + (chorus ? [0, .015, .03][i] : 0));
        }
        let smooth = 0;
        const lip = globalThis.setInterval(() => {
          if (active !== next || token !== generation) { globalThis.clearInterval(lip); return; }
          analyser.getByteTimeDomainData(data); let sum = 0; for (const sample of data) { const n = (sample - 128) / 128; sum += n * n; }
          const rms = Math.sqrt(sum / data.length), target = clamp(rms * 3.5, 0, 1); smooth += (target - smooth) * (target > smooth ? .5 : .15); deps.setMouth(next.item.agentId, smooth);
        }, 34);
        const originalEnd = finishCurrent;
        finishCurrent = outcome => { globalThis.clearInterval(lip); for (const source of sources) { try { source.stop(); } catch { /* already ended */ } } originalEnd?.(outcome); };
      } catch { end('failed'); }
    };
    void play();
  };
  const enqueue: SpeechQueue['enqueue'] = item => {
    const e: Entry = { item, at: clock.now(), ready: false }; queue.push(e);
    if (!enabled || disposed) { remove(e); emitEnd(e, 'muted'); return; }
    if (item.priority === 'report' || item.priority === 'ack') e.expiry = clock.setTimeout(() => { if (queue.includes(e)) { remove(e); e.done?.('dropped'); emitEnd(e, 'dropped'); pump(); } }, 8000);
    const fetchMore = () => {
      while (inflight < 2) {
        const pending = queue.find(x => !x.ready && !('fetching' in x)); if (!pending) break;
        (pending as Entry & { fetching?: boolean }).fetching = true; inflight++;
        Promise.resolve().then(() => deps.speak(pending.item.agentId, pending.item.text, pending.item.mood)).then(bytes => { pending.bytes = bytes; pending.ready = true; }, err => { pending.error = err; pending.ready = true; if (queue.includes(pending)) { remove(pending); emitEnd(pending, 'failed'); } }).finally(() => { inflight--; fetchMore(); pump(); });
      }
    };
    fetchMore();
  };
  return {
    enqueue,
    clear() { for (const e of [...queue]) { remove(e); emitEnd(e, 'cleared'); } if (active) finishCurrent?.('cleared'); },
    get current() { return active?.item ?? null; },
    setVoiceEnabled(on) { enabled = on; if (!on) { if (active) finishCurrent?.('muted'); for (const e of [...queue]) { remove(e); emitEnd(e, 'muted'); } } else pump(); },
    setVolume(v) { volume = clamp(v, 0, 1); if (master) master.gain.value = volume; },
    onStart(cb) { starts.add(cb); return () => starts.delete(cb); }, onEnd(cb) { ends.add(cb); return () => ends.delete(cb); },
    dispose() { disposed = true; if (active) finishCurrent?.('cleared'); for (const e of [...queue]) { remove(e); emitEnd(e, 'cleared'); } starts.clear(); ends.clear(); },
  };
}
