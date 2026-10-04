import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ ipcMain: {} }));
import { isAgentId, isBoolean, isHubTab, isRects, isTaskId } from './shellIpc';

describe('shell IPC payloads', () => {
  it('validates booleans, agents, tabs and task IDs', () => {
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isAgentId('chipmunk')).toBe(true);
    expect(isAgentId('__proto__')).toBe(false);
    expect(isHubTab('marketplace')).toBe(true);
    expect(isHubTab('other')).toBe(false);
    expect(isTaskId('task-1')).toBe(true);
    expect(isTaskId('x'.repeat(201))).toBe(false);
  });
  it('rejects malformed and oversized rect arrays', () => {
    expect(isRects([{ x: 0, y: 0, width: 1, height: 1 }])).toBe(true);
    expect(isRects(Array(65).fill({ x: 0, y: 0, width: 1, height: 1 }))).toBe(false);
    expect(isRects([{ x: Infinity, y: 0, width: 1, height: 1 }])).toBe(false);
    expect(isRects([{ x: 0, y: 0, width: -1, height: 1 }])).toBe(false);
    expect(isRects(null)).toBe(false);
  });
});
