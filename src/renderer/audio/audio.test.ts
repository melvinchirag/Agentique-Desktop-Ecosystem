import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpeechQueue } from './speechQueue';
import { createSfxPlayer } from './sfx';
import { createMicRecorder } from './mic';
import { createPushToTalk } from './pushToTalk';
import type { SpeechItem } from '../shell/contracts';

const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fakeClock() {
  let now = 0, id = 0; const timers = new Map<number, { at: number; fn: () => void }>();
  return { now: () => now, setTimeout(fn: () => void, ms: number) { const n = ++id; timers.set(n, { at: now + ms, fn }); return n; }, clearTimeout(handle: unknown) { timers.delete(handle as number); }, advance(ms: number) { now += ms; for (const [n, timer] of [...timers]) if (timer.at <= now) { timers.delete(n); timer.fn(); } } };
}
function fakeAudio(duration = 1) {
  const sources: any[] = [], gains: any[] = [];
  const ac: any = { state: 'running', currentTime: 0, destination: {}, resume: vi.fn(), decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => { if (!bytes.byteLength) throw new Error('empty'); return { duration }; }),
    createGain() { const n: any = { gain: { value: 1 }, connect: vi.fn() }; gains.push(n); return n; },
    createAnalyser() { return { fftSize: 256, connect: vi.fn(), getByteTimeDomainData(data: Uint8Array) { data.fill(180); } }; },
    createBufferSource() { const n: any = { detune: { value: 0 }, connect: vi.fn(), start: vi.fn((when: number) => { n.when = when; }), stop: vi.fn(), buffer: null, onended: null }; sources.push(n); return n; },
  };
  return { ac, sources, gains };
}
const item = (priority: SpeechItem['priority'], agentId: SpeechItem['agentId'] = 'chipmunk', text = 'Hello'): SpeechItem => ({ priority, agentId, text, mood: 'neutral' });

describe('speech queue', () => {
  afterEach(() => vi.useRealTimers());
  it('plays highest priority first, one voice at a time, and drops old reports but keeps chip', async () => {
    const clock = fakeClock(), audio = fakeAudio(); const order: string[] = [], outcomes: string[] = [];
    const q = createSpeechQueue({ clock, audioContext: () => audio.ac, speak: async (_a, text) => { order.push(`fetch:${text}`); return new ArrayBuffer(1); }, setMouth: () => undefined });
    q.onEnd((speech, outcome) => outcomes.push(`${speech.text}:${outcome}`));
    q.enqueue(item('chip', 'chipmunk', 'chip')); q.enqueue(item('report', 'workspace', 'report')); q.enqueue(item('warden', 'wolf', 'warden'));
    clock.advance(8000); await tick();
    expect(q.current?.text).toBe('warden'); expect(outcomes).toContain('report:dropped'); expect(audio.sources).toHaveLength(1);
    audio.sources[0].onended(); await tick(); expect(q.current?.text).toBe('chip');
    q.dispose(); expect(outcomes).toContain('chip:cleared');
  });
  it('continues after speak failure and creates the three ant chorus sources', async () => {
    const audio = fakeAudio(), mouth = vi.fn(); let calls = 0;
    const q = createSpeechQueue({ audioContext: () => audio.ac, speak: async () => { if (++calls === 1) throw new Error('offline'); return new ArrayBuffer(1); }, setMouth: mouth });
    const done: string[] = []; q.onEnd((s, out) => done.push(`${s.text}:${out}`));
    q.enqueue(item('warden', 'wolf', 'failed')); q.enqueue(item('report', 'ants', 'swarm')); await tick();
    expect(done).toContain('failed:failed'); expect(audio.sources).toHaveLength(3);
    expect(audio.sources.map(s => s.detune.value)).toEqual([0, 25, -25]);
    expect(audio.sources.map(s => s.when)).toEqual([0, .015, .03]);
    q.setVolume(.25); expect(audio.gains[0].gain.value).toBe(.25);
    audio.sources[2].onended(); expect(mouth).toHaveBeenCalledWith('ants', 0);
    q.dispose();
  });
  it('uses silence timing and procedural mouth movement for an empty buffer; mute and clear end queued work', async () => {
    vi.useFakeTimers(); const audio = fakeAudio(), clock = fakeClock(), mouth = vi.fn();
    const q = createSpeechQueue({ clock, audioContext: () => audio.ac, speak: async () => new ArrayBuffer(0), setMouth: mouth });
    const outcomes: string[] = []; q.onEnd((s, o) => outcomes.push(`${s.text}:${o}`));
    q.enqueue(item('chip', 'chipmunk', 'x')); await tick(); vi.advanceTimersByTime(34);
    expect(mouth).toHaveBeenCalledWith('chipmunk', expect.any(Number));
    vi.advanceTimersByTime(900); expect(outcomes).toContain('x:played'); expect(mouth).toHaveBeenCalledWith('chipmunk', 0);
    q.enqueue(item('report', 'workspace', 'waiting')); q.clear(); expect(outcomes).toContain('waiting:cleared');
    q.setVoiceEnabled(false); q.enqueue(item('ack', 'workspace', 'muted')); expect(outcomes).toContain('muted:muted');
    q.dispose();
  });
});

describe('SFX, mic, and push to talk', () => {
  it('silently handles unknown names and a missing manifest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined), fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const sfx = createSfxPlayer({ baseUrl: '/sfx' }); sfx.play('unknown'); await tick();
    expect(fetchSpy).toHaveBeenCalledOnce(); expect(warn).toHaveBeenCalledOnce(); fetchSpy.mockRestore(); warn.mockRestore();
  });
  it('auto-stops the recorder at maxMs and returns captured bytes while stopping tracks', async () => {
    vi.useFakeTimers(); const stopTrack = vi.fn(); const track = { stop: stopTrack };
    const recorder: any = { state: 'inactive', mimeType: 'audio/webm', start() { this.state = 'recording'; this.ondataavailable({ data: new Blob(['voice'], { type: this.mimeType }) }); }, stop() { this.state = 'inactive'; this.onstop(); } };
    vi.stubGlobal('MediaRecorder', Object.assign(class { constructor() { return recorder; } static isTypeSupported() { return true; } }, { isTypeSupported: () => true }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
    const mic = createMicRecorder({ maxMs: 100 }); await mic.start(); vi.advanceTimersByTime(100); await tick();
    const result = await mic.stop(); expect(result?.mime).toBe('audio/webm'); expect(new Uint8Array(result!.audio).length).toBeGreaterThan(0); expect(stopTrack).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
  it('focuses on a short click and sends audio for a hold', async () => {
    const clock = fakeClock(), focus = vi.fn(), sendVoice = vi.fn(), stop = vi.fn(async () => ({ audio: new Uint8Array([1, 2]).buffer, mime: 'audio/webm' }));
    const mic = { recording: false, start: vi.fn(async () => undefined), stop };
    const ptt = createPushToTalk({ mic, sendVoice, focusChat: focus, clock });
    ptt.pointerDown(); ptt.pointerUp(); await tick(); expect(focus).toHaveBeenCalledOnce(); expect(sendVoice).not.toHaveBeenCalled();
    ptt.pointerDown(); clock.advance(300); ptt.pointerUp(); await tick(); expect(sendVoice).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'audio/webm');
  });
});
