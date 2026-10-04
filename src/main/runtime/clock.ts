import type { Clock, TimerHandle } from './types';

/** The real clock. Used by the app and by chip-cli live mode. */
export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    return globalThis.setTimeout(fn, ms);
  }
  clearTimeout(h: TimerHandle): void {
    globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>);
  }
}

interface FakeTimer { id: number; due: number; seq: number; fn: () => void }

/**
 * A clock that only moves when a test says so.
 * - advance(ms): fires every timer due within the window, in due order (ties: scheduling order).
 *   Timers scheduled while advancing also fire if they fall inside the window. `now()` equals each
 *   timer's due time while it runs, and the end of the window afterwards.
 * - advanceAsync(ms): same, but lets pending promises settle before and after each timer. Use it
 *   when the code under test awaits between timers (jobs, nudges, the orchestrator).
 */
export class FakeClock implements Clock {
  private t: number;
  private nextId = 1;
  private seq = 0;
  private timers = new Map<number, FakeTimer>();

  constructor(start: number | Date = Date.UTC(2026, 9, 4, 16, 0, 0)) {
    this.t = typeof start === 'number' ? start : start.getTime();
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { id, due: this.t + Math.max(0, ms), seq: this.seq++, fn });
    return id;
  }

  clearTimeout(h: TimerHandle): void {
    if (typeof h === 'number') this.timers.delete(h);
  }

  /** Number of timers waiting to fire. */
  pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (let next = this.takeNext(end); next; next = this.takeNext(end)) {
      this.t = next.due;
      next.fn();
    }
    this.t = end;
  }

  async advanceAsync(ms: number): Promise<void> {
    const end = this.t + ms;
    await flushPromises();
    for (let next = this.takeNext(end); next; next = this.takeNext(end)) {
      this.t = next.due;
      next.fn();
      await flushPromises();
    }
    this.t = end;
    await flushPromises();
  }

  private takeNext(end: number): FakeTimer | undefined {
    let best: FakeTimer | undefined;
    for (const timer of this.timers.values()) {
      if (timer.due > end) continue;
      if (!best || timer.due < best.due || (timer.due === best.due && timer.seq < best.seq)) best = timer;
    }
    if (best) this.timers.delete(best.id);
    return best;
  }
}

/** Lets every already-settled promise chain run. */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
