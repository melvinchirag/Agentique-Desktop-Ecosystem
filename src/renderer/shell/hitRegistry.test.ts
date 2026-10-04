import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../main/runtime/types';
import { createHitRegistry } from './hitRegistry';

const rect = { x: 0, y: 0, width: 20, height: 20 };
const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const sink = () => ({ setInteractive: vi.fn(), publishHitShapes: vi.fn() });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hit registry', () => {
  it('selects DOM shapes over animals and last set among equals', () => {
    const api = createHitRegistry(sink(), { clock });
    api.set('animal', 'animal', rect);
    api.set('bubble', 'bubble', rect);
    api.set('card', 'card', rect);
    expect(api.hitTest({ x: 10, y: 10 })?.id).toBe('card');
    api.set('bubble', 'bubble', rect);
    expect(api.hitTest({ x: 10, y: 10 })?.id).toBe('bubble');
    api.remove('bubble');
    expect(api.hitTest({ x: 10, y: 10 })?.id).toBe('card');
    api.dispose();
  });

  it('changes interaction only on transitions and debounces leaving', () => {
    const events = sink();
    const api = createHitRegistry(events, { clock, leaveDebounceMs: 60 });
    api.set('animal', 'animal', rect);
    api.pointerMove({ x: 5, y: 5 });
    api.pointerMove({ x: 6, y: 6 });
    expect(events.setInteractive.mock.calls).toEqual([[true]]);
    api.pointerMove({ x: 30, y: 30 });
    vi.advanceTimersByTime(59);
    expect(events.setInteractive).toHaveBeenCalledTimes(1);
    api.pointerMove({ x: 10, y: 10 });
    vi.advanceTimersByTime(60);
    expect(events.setInteractive).toHaveBeenCalledTimes(1);
    api.pointerMove({ x: 30, y: 30 });
    vi.advanceTimersByTime(60);
    expect(events.setInteractive.mock.calls).toEqual([[true], [false]]);
    api.dispose();
  });

  it('holds interactivity while captured and rechecks the last pointer on release', () => {
    const events = sink();
    const api = createHitRegistry(events, { clock });
    api.setCaptured(true);
    api.pointerMove({ x: 100, y: 100 });
    api.setCaptured(false);
    vi.advanceTimersByTime(60);
    expect(events.setInteractive.mock.calls).toEqual([[true], [false]]);
    api.dispose();
  });

  it('throttles changed shapes and clears pending timers on dispose', () => {
    const events = sink();
    const api = createHitRegistry(events, { clock, publishHz: 10 });
    api.set('animal', 'animal', rect);
    vi.advanceTimersByTime(0);
    expect(events.publishHitShapes).toHaveBeenCalledTimes(1);
    api.set('animal', 'animal', rect);
    vi.advanceTimersByTime(100);
    expect(events.publishHitShapes).toHaveBeenCalledTimes(1);
    api.set('animal', 'animal', { ...rect, x: 1 });
    api.set('banner', 'banner', rect);
    vi.advanceTimersByTime(0);
    expect(events.publishHitShapes).toHaveBeenCalledTimes(2);
    api.remove('banner');
    api.pointerMove({ x: 100, y: 100 });
    api.dispose();
    vi.advanceTimersByTime(1000);
    expect(events.publishHitShapes).toHaveBeenCalledTimes(2);
  });
});
