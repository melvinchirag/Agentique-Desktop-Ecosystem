import { describe, expect, it, vi } from 'vitest';
import { createMockAdeApi, createMockShellApi, makeEvent } from './mocks';

describe('shell mocks', () => {
  it('makes complete events and delivers only to subscribed ADE callbacks', async () => {
    const api = createMockAdeApi();
    const cb = vi.fn();
    const off = api.onEvent(cb);
    const event = makeEvent({ type: 'agent.say', agentId: 'chipmunk', text: 'hello', bubble: 'hi', priority: 'chip' }, 123);
    expect(event).toMatchObject({ ts: 123, sessionId: 'mock-session' });
    expect(event.id).toBeTruthy();
    api.emit(event);
    expect(cb).toHaveBeenCalledWith(event);
    off(); api.emit(event);
    expect(cb).toHaveBeenCalledTimes(1);
    await api.sendMessage('Hello', 'text');
    expect(api.calls.at(-1)).toEqual({ method: 'sendMessage', args: ['Hello', 'text'] });
    expect(Object.keys((await api.getSettings()).models)).toHaveLength(8);
  });
  it('has a useful layout, records shell calls, and supports pushed callbacks', async () => {
    const shell = createMockShellApi();
    expect((await shell.getLayout()).workArea).toEqual({ x: 0, y: 0, width: 1536, height: 816 });
    expect((await shell.getLayout()).hubBounds.x).toBe(1160);
    shell.setInteractive(true);
    expect(shell.calls.at(-1)).toEqual({ method: 'setInteractive', args: [true] });
    const cb = vi.fn();
    const off = shell.onFocusChat(cb);
    shell.emitFocusChat(); off(); shell.emitFocusChat();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
