import type { Gait } from '../../shell/contracts';

export const GAIT_SPEED: Record<Gait, number> = { walk: 120, run: 260, sleepwalk: 60, fly: 300 };
export const gaitClip: Record<Gait, string> = { walk: 'Walk', run: 'Run', sleepwalk: 'SleepWalk', fly: 'Fly' };
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export function travelDuration(from: number, to: number, gait: Gait, walkSpeed = 1): number {
  return Math.abs(to - from) / (GAIT_SPEED[gait] * (walkSpeed > 0 ? walkSpeed : 1));
}
export function tween(from: number, to: number, started: number, duration: number, now: number): number {
  return from + (to - from) * clamp01(duration ? (now - started) / duration : 1);
}
export class MotionSlot {
  private done: (() => void) | null = null;
  start(): Promise<void> {
    this.cancel();
    return new Promise(resolve => { this.done = resolve; });
  }
  finish(): void { const done = this.done; this.done = null; done?.(); }
  cancel(): void { this.finish(); }
}
