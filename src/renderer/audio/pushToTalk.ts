import type { CreatePushToTalk } from '../shell/contracts';
import type { Clock } from '../../main/runtime/types';

export const createPushToTalk: CreatePushToTalk = ({ mic, sendVoice, focusChat, shortClickMs = 250, clock }) => {
  const time: Clock = clock ?? { now: Date.now, setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: h => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>) };
  let downAt: number | null = null, startTask: Promise<void> | undefined, busy = false;
  return {
    get recording() { return downAt !== null; },
    pointerDown() {
      if (downAt !== null || busy) return;
      downAt = time.now(); busy = true;
      startTask = mic.start().catch(error => { console.warn('Microphone recording failed.', error); }).finally(() => { busy = false; });
    },
    pointerUp() {
      if (downAt === null) return;
      const elapsed = time.now() - downAt; downAt = null;
      void (async () => {
        try {
          await startTask;
          const result = await mic.stop();
          if (elapsed < shortClickMs) focusChat();
          else if (result) await sendVoice(result.audio, result.mime);
        } catch (error) { console.warn('Push-to-talk failed.', error); }
      })();
    },
    cancel() {
      if (downAt === null) return;
      downAt = null;
      void (async () => { try { await startTask; await mic.stop(); } catch { /* nothing was sent */ } })();
    },
  };
};
