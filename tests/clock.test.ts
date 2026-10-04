import { describe, expect, it } from 'vitest';
import { FakeClock, RealClock } from '../src/main/runtime/clock';

describe('FakeClock', () => {
  it('starts at the given time and only moves on advance', () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });

  it('fires due timers in due order, ties in scheduling order, with now() = due time', () => {
    const clock = new FakeClock(0);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push(`b@${clock.now()}`), 200);
    clock.setTimeout(() => fired.push(`a@${clock.now()}`), 100);
    clock.setTimeout(() => fired.push(`c@${clock.now()}`), 200);
    clock.setTimeout(() => fired.push('late'), 301);
    clock.advance(300);
    expect(fired).toEqual(['a@100', 'b@200', 'c@200']);
    expect(clock.now()).toBe(300);
    expect(clock.pending()).toBe(1);
  });

  it('fires timers scheduled during advance when they fall inside the window', () => {
    const clock = new FakeClock(0);
    const fired: number[] = [];
    clock.setTimeout(() => {
      fired.push(clock.now());
      clock.setTimeout(() => fired.push(clock.now()), 50);
    }, 100);
    clock.advance(200);
    expect(fired).toEqual([100, 150]);
  });

  it('clearTimeout cancels', () => {
    const clock = new FakeClock(0);
    let hit = false;
    const h = clock.setTimeout(() => (hit = true), 10);
    clock.clearTimeout(h);
    clock.advance(100);
    expect(hit).toBe(false);
  });

  it('advanceAsync lets awaited work schedule further timers', async () => {
    const clock = new FakeClock(0);
    const log: number[] = [];
    const loop = async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise<void>((r) => clock.setTimeout(r, 1000));
        log.push(clock.now());
      }
    };
    const done = loop();
    await clock.advanceAsync(5000);
    await done;
    expect(log).toEqual([1000, 2000, 3000]);
  });
});

describe('RealClock', () => {
  it('fires a real timer', async () => {
    const clock = new RealClock();
    const t0 = clock.now();
    await new Promise<void>((r) => clock.setTimeout(r, 5));
    expect(clock.now()).toBeGreaterThanOrEqual(t0);
  });
});
