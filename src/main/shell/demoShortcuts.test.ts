import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ globalShortcut: {} }));
import { shouldRegister } from './demoShortcuts';

describe('demo shortcut eligibility', () => {
  it('registers only in demo or dev mode', () => {
    expect(shouldRegister(false, false)).toBe(false);
    expect(shouldRegister(true, false)).toBe(true);
    expect(shouldRegister(false, true)).toBe(true);
    expect(shouldRegister(true, true)).toBe(true);
  });
});
