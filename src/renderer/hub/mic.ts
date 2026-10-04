export interface MicRecordingResult {
  audio: ArrayBuffer;
  mime: string;
}

/**
 * Self-contained microphone audio recorder for hold-to-talk.
 * Starts a MediaRecorder on getUserMedia({ audio: true }); auto-stops at maxMs (default 30 000 ms).
 */
export class HubMicRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private _isRecording = false;

  get isRecording(): boolean {
    return this._isRecording;
  }

  async start(maxDurationMs = 30000, onMaxDuration?: (result: MicRecordingResult) => void): Promise<void> {
    if (this._isRecording) return;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      this._isRecording = true;
      if (maxDurationMs > 0) {
        this.timeoutId = setTimeout(async () => {
          if (this._isRecording) {
            const res = await this.stop();
            if (res && onMaxDuration) {
              onMaxDuration(res);
            }
          }
        }, maxDurationMs);
      }
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];

      let mimeType = 'audio/webm';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        }
      }

      this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.start(100);
      this._isRecording = true;

      if (maxDurationMs > 0) {
        this.timeoutId = setTimeout(async () => {
          if (this._isRecording) {
            const res = await this.stop();
            if (res && onMaxDuration) {
              onMaxDuration(res);
            }
          }
        }, maxDurationMs);
      }
    } catch (err) {
      this._isRecording = false;
      this.cleanup();
      throw err;
    }
  }

  async stop(): Promise<MicRecordingResult | null> {
    if (!this._isRecording) return null;
    this._isRecording = false;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (!this.mediaRecorder) {
      this.cleanup();
      return { audio: new ArrayBuffer(0), mime: 'audio/webm' };
    }

    return new Promise<MicRecordingResult | null>((resolve) => {
      const recorder = this.mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        this.cleanup();
        resolve(null);
        return;
      }

      recorder.onstop = async () => {
        try {
          const mime = recorder.mimeType || 'audio/webm';
          const blob = new Blob(this.chunks, { type: mime });
          const audio = await blob.arrayBuffer();
          this.cleanup();
          resolve({ audio, mime });
        } catch {
          this.cleanup();
          resolve(null);
        }
      };

      recorder.stop();
    });
  }

  private cleanup(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.chunks = [];
  }
}
