import type { CreateMicRecorder } from '../shell/contracts';

export const createMicRecorder: CreateMicRecorder = ({ maxMs = 30000 } = {}) => {
  let recorder: MediaRecorder | undefined, stream: MediaStream | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let chunks: BlobPart[] = [], mime = '', completed: { audio: ArrayBuffer; mime: string } | null = null;
  const stopTracks = () => { stream?.getTracks().forEach(track => track.stop()); stream = undefined; };
  const stop = (): Promise<{ audio: ArrayBuffer; mime: string } | null> => new Promise(resolve => {
    if (timer) clearTimeout(timer); timer = undefined;
    const current = recorder; recorder = undefined;
    if (!current || current.state === 'inactive') { stopTracks(); resolve(completed); return; }
    current.onstop = async () => {
      stopTracks(); const blob = new Blob(chunks, { type: mime }); chunks = [];
      if (!blob.size) { completed = null; resolve(null); return; }
      completed = { audio: await blob.arrayBuffer(), mime }; resolve(completed);
    };
    try { current.stop(); } catch { stopTracks(); resolve(null); }
  });
  return {
    get recording() { return !!recorder && recorder.state !== 'inactive'; },
    async start() {
      if (recorder) return;
      completed = null;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true }); chunks = [];
      const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t));
      try {
        recorder = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream);
        mime = recorder.mimeType || supported || 'audio/webm';
        const current = recorder; current.ondataavailable = e => { if (e.data.size) chunks.push(e.data); }; current.start();
      } catch (error) { recorder = undefined; stopTracks(); throw error; }
      timer = setTimeout(() => { void stop(); }, maxMs);
    },
    async stop() { const result = await stop(); completed = null; return result; },
  };
};
