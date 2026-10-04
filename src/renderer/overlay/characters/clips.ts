import { AnimationAction, AnimationClip, AnimationMixer, LoopOnce, LoopRepeat } from 'three';

export type Procedural = 'hop' | 'bob' | 'tremble' | 'squash' | 'spin' | 'slow-bob' | 'gait-bob';
const PROCEDURAL: Record<string, Procedural> = {
  Happy: 'hop', Celebrate: 'hop', Greet: 'hop', Excited: 'hop', Relief: 'hop',
  Idle: 'bob', Talk: 'bob', TalkHappy: 'bob', Listen: 'bob', Think: 'bob',
  Scared: 'tremble', Nervous: 'tremble', TalkScared: 'tremble', Worried: 'tremble',
  Work: 'squash', Handoff: 'squash', Nudge: 'squash', Block: 'squash', TailSlap: 'squash',
  Dizzy: 'spin', Sleep: 'slow-bob', Yawn: 'slow-bob', WakeUp: 'slow-bob',
  Walk: 'gait-bob', Run: 'gait-bob', SleepWalk: 'gait-bob', Fly: 'gait-bob', Carry: 'gait-bob',
};
export const proceduralFor = (name: string): Procedural => PROCEDURAL[name] ?? 'bob';
export function resolveClip(name: string, clipMap: Record<string, string> | undefined, clips: readonly AnimationClip[]): AnimationClip | null {
  return clips.find(clip => clip.name === (clipMap?.[name] ?? name)) ?? null;
}
export function proceduralPose(kind: Procedural, seconds: number, once = false): { y: number; x: number; scaleY: number; rotation: number } {
  const t = seconds * Math.PI * 2;
  const envelope = once ? Math.sin(Math.PI * Math.min(1, seconds)) : 1;
  switch (kind) {
    case 'hop': return { y: Math.abs(Math.sin(t * 1.5)) * 9 * envelope, x: 0, scaleY: 1, rotation: 0 };
    case 'tremble': return { y: 0, x: Math.sin(t * 8) * 2 * envelope, scaleY: 0.94, rotation: 0 };
    case 'squash': return { y: 0, x: 0, scaleY: 1 - Math.abs(Math.sin(t * 1.5)) * 0.1 * envelope, rotation: 0 };
    case 'spin': return { y: 0, x: 0, scaleY: 1, rotation: t * envelope };
    case 'slow-bob': return { y: Math.sin(t * 0.25) * 1.2, x: 0, scaleY: 1, rotation: 0 };
    case 'gait-bob': return { y: Math.abs(Math.sin(t * 2)) * 2.5, x: 0, scaleY: 1, rotation: 0 };
    default: return { y: Math.sin(t * 0.5) * 2, x: 0, scaleY: 1, rotation: 0 };
  }
}

export class ClipPlayer {
  readonly mixer: AnimationMixer;
  private action: AnimationAction | null = null;
  private finish: (() => void) | null = null;
  private loop = 'Idle';
  private onceUntil = 0;
  private began = 0;
  private current = 'Idle';
  constructor(root: ConstructorParameters<typeof AnimationMixer>[0], private readonly clips: readonly AnimationClip[], private readonly clipMap?: Record<string, string>) {
    this.mixer = new AnimationMixer(root);
  }
  get loopName(): string { return this.loop; }
  get currentName(): string { return this.current; }
  get isOneShot(): boolean { return this.finish !== null; }
  get isCrossfading(): boolean { return this.mixer.time - this.began < 0.25; }
  get procedural(): Procedural | null { return resolveClip(this.current, this.clipMap, this.clips) ? null : proceduralFor(this.current); }
  get proceduralSeconds(): number { return this.mixer.time - this.began; }
  play(name: string, once = false): Promise<void> {
    if (!once) this.loop = name;
    if (this.finish) { this.finish(); this.finish = null; }
    this.current = name;
    this.began = this.mixer.time;
    const clip = resolveClip(name, this.clipMap, this.clips);
    const next = clip ? this.mixer.clipAction(clip) : null;
    if (next) {
      next.reset();
      if (once) { next.setLoop(LoopOnce, 1); next.clampWhenFinished = true; }
      else { next.setLoop(LoopRepeat, Infinity); next.clampWhenFinished = false; }
      next.enabled = true;
      next.play();
      if (this.action && this.action !== next) next.crossFadeFrom(this.action, 0.25, false);
    }
    if (this.action && this.action !== next && !next) this.action.fadeOut(0.25);
    this.action = next;
    if (!once) return Promise.resolve();
    this.onceUntil = this.mixer.time + (clip?.duration ?? 1);
    return new Promise(resolve => { this.finish = resolve; });
  }
  update(dt: number): void {
    this.mixer.update(dt);
    if (this.finish && this.mixer.time >= this.onceUntil) {
      const done = this.finish;
      this.finish = null;
      void this.play(this.loop);
      done();
    }
  }
  dispose(): void { this.finish?.(); this.finish = null; this.mixer.stopAllAction(); }
}
