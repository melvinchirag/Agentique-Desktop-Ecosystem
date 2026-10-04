import { describe, expect, it } from 'vitest';
import type { DisplayLayout } from '../../main/shell/contracts';
import { computeLayout } from './layout';

function display(width: number, height: number, scaleFactor: number): DisplayLayout {
  return {
    workArea: { x: 80, y: 40, width, height },
    displayBounds: { x: 80, y: 40, width, height: height + 40 },
    hubBounds: { x: 80 + width - 380, y: 60, width: 360, height: 560 },
    scaleFactor, hubCollapsed: false, animalsHidden: false, demoMode: false, devMode: false,
  };
}

describe('computeLayout', () => {
  it.each([[1920, 1040, 1], [1536, 816, 1.25], [1280, 680, 1.5]])(
    'uses DIP work area at %ix%i and scale %i', (width, height, scale) => {
      const result = computeLayout(display(width, height, scale));
      expect(result).toMatchObject({ width, height, groundY: height - 4, centerX: width / 2,
        colonyX: width * 0.06, hubX: width - 200, dockPoint: { x: width - 200, y: 48 } });
      expect(result.spots).toEqual({
        ants: width * 0.06, beaver: width * 0.16, workspace: width * 0.26,
        chipmunk: width * 0.38, wolf: width * 0.5, eagle: width * 0.6,
        butterfly: width * 0.7, nightingale: width * 0.78,
      });
    },
  );

  it('tracks a dragged and collapsed Hub and clamps its dock point', () => {
    const d = display(1536, 816, 1.25);
    d.hubBounds = { x: 200, y: 260, width: 360, height: 56 };
    d.hubCollapsed = true;
    expect(computeLayout(d).dockPoint).toEqual({ x: 300, y: 248 });
    d.hubBounds = { x: -500, y: -500, width: 360, height: 56 };
    expect(computeLayout(d).dockPoint).toEqual({ x: 0, y: 0 });
    d.hubBounds = { x: 2000, y: 2000, width: 360, height: 56 };
    expect(computeLayout(d).dockPoint).toEqual({ x: 1536, y: 816 });
  });
});
