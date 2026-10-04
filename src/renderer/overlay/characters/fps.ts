export interface FrameState {
  visible: boolean;
  active: number;
  moving: boolean;
  crossfading: boolean;
  oneShot: boolean;
  talking: boolean;
  tinting: boolean;
  idleLoops: boolean;
}

export function targetFps(state: FrameState): 0 | 10 | 30 {
  if (!state.visible || state.active === 0) return 0;
  if (state.moving || state.crossfading || state.oneShot || state.talking || state.tinting) return 30;
  return state.idleLoops ? 10 : 0;
}

export class FrameDriver {
  private timer: ReturnType<typeof setInterval> | null = null;
  private fps = 0;
  constructor(private readonly invalidate: () => void) {}
  setFps(fps: 0 | 10 | 30): void {
    if (this.fps === fps) return;
    if (this.timer) clearInterval(this.timer);
    this.fps = fps;
    this.timer = fps ? setInterval(this.invalidate, 1000 / fps) : null;
    this.invalidate();
  }
  dispose(): void { this.setFps(0); }
}
