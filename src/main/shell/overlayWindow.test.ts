import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }));
import { pointInAny } from './overlayWindow';

describe('poll hit testing', () => {
  const rects = [{ x: 10, y: 20, width: 30, height: 40 }];
  it('includes edges and rejects points outside overlay-local shapes', () => {
    expect(pointInAny(rects, { x: 10, y: 20 })).toBe(true);
    expect(pointInAny(rects, { x: 40, y: 60 })).toBe(true);
    expect(pointInAny(rects, { x: 41, y: 60 })).toBe(false);
    expect(pointInAny([], { x: 20, y: 30 })).toBe(false);
  });
});
