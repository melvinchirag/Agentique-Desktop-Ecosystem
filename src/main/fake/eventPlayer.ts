import type { Clock } from '../runtime/types';
import type { CreateEventPlayer, EventPlayer, TimedEvent } from '../shell/contracts';
const defaultClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) };
export const createEventPlayer: CreateEventPlayer = <E>(opts: { clock?: Clock; speed?: number } = {}): EventPlayer<E> => {
  const clock = opts.clock ?? defaultClock; let speed = opts.speed ?? 1; let state: EventPlayer<E>['state'] = 'idle'; let queue: TimedEvent<E>[] = []; let index = 0; let timer: unknown; let dueAt = 0; let remaining = 0; let callback: ((event: E) => void) | undefined; const done = new Set<() => void>();
  const clear = () => { if (timer !== undefined) clock.clearTimeout(timer); timer = undefined; };
  const finish = () => { state = 'done'; for (const cb of [...done]) cb(); };
  const schedule = (delay: number) => { clear(); remaining = Math.max(0, delay); dueAt = clock.now() + remaining; timer = clock.setTimeout(() => { timer = undefined; if (state !== 'playing') return; const item = queue[index++]; if (item) callback?.(item.event); if (index >= queue.length) finish(); else schedule((queue[index].atMs - queue[index - 1].atMs) / speed); }, remaining); };
  return { get state() { return state; }, load(items) { clear(); queue = items.map((item, order) => ({ item, order })).sort((a,b) => a.item.atMs-b.item.atMs || a.order-b.order).map(x=>x.item); index=0; state='idle'; }, play(onEvent) { clear(); index=0; callback=onEvent; state='playing'; if (!queue.length) finish(); else schedule(queue[0].atMs/speed); }, pause() { if(state!=='playing') return; remaining=Math.max(0,dueAt-clock.now()); clear(); state='paused'; }, resume() { if(state!=='paused') return; state='playing'; schedule(remaining); }, stop() { clear(); state='idle'; index=0; callback=undefined; }, setSpeed(multiplier) { if(!(multiplier>0) || !Number.isFinite(multiplier)) throw new Error('speed must be positive'); if(state==='playing') { const left=Math.max(0,dueAt-clock.now()); const oldSpeed=speed; speed=multiplier; schedule(left*oldSpeed/speed); } else speed=multiplier; }, onDone(cb) { done.add(cb); return ()=>done.delete(cb); } };
};


