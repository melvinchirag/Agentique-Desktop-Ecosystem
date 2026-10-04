import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ screen: {} }));
import { buildDisplayLayout, hubBoundsFor } from './display';

describe('display math', () => {
  it.each([
    [1920, 1040, 1],
    [1536, 816, 1.25],
    [1280, 680, 1.5],
  ])('uses DIP work area %ix%i at scale %i', (width, height, scaleFactor) => {
    const workArea = { x: 80, y: 20, width, height };
    const hub = hubBoundsFor(workArea, false);
    expect(hub).toEqual({ x: 80 + width - 376, y: 36, width: 360, height: 560 });
    const layout = buildDisplayLayout({ workArea, bounds: { x: 0, y: 0, width, height: height + 40 }, scaleFactor }, hub, {
      hubCollapsed: false, animalsHidden: false, demoMode: true, devMode: false,
    });
    expect(layout.workArea).toEqual(workArea);
    expect(layout.scaleFactor).toBe(scaleFactor);
    expect(layout.hubBounds).toEqual(hub);
    expect(layout.demoMode).toBe(true);
  });

  it('keeps a dragged position and clamps after the work area shrinks', () => {
    const original = { x: 0, y: 0, width: 1920, height: 1040 };
    const dragged = hubBoundsFor(original, false, { x: 1500, y: 700, width: 360, height: 560 });
    expect(dragged).toEqual({ x: 1500, y: 480, width: 360, height: 560 });
    const small = { x: 100, y: 30, width: 900, height: 650 };
    expect(hubBoundsFor(small, false, dragged)).toEqual({ x: 640, y: 120, width: 360, height: 560 });
    expect(hubBoundsFor(small, true, dragged)).toEqual({ x: 640, y: 480, width: 360, height: 56 });
  });
});
