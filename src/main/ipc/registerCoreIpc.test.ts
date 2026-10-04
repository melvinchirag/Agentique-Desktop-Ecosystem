import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { BiomeEvent } from '../../shared/events';
import type { CoreAdapter, IpcMainLike, WebContentsLike } from '../shell/contracts';
import { createFakeCore } from '../fake';
import { registerCoreIpc } from './registerCoreIpc';

function fixture() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = {
    handle: (channel, listener) => { handlers.set(channel, listener); },
    removeHandler: channel => { handlers.delete(channel); },
  };
  let subscriber: ((event: BiomeEvent) => void) | undefined;
  const unsubscribe = vi.fn(() => { subscriber = undefined; });
  const adapter = createFakeCore();
  adapter.subscribe = cb => { subscriber = cb; return unsubscribe; };
  const live = { send: vi.fn(), isDestroyed: () => false } satisfies WebContentsLike;
  const destroyed = { send: vi.fn(), isDestroyed: () => true } satisfies WebContentsLike;
  const throwing = { send: vi.fn(() => { throw new Error('window failed'); }), isDestroyed: () => false } satisfies WebContentsLike;
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const dispose = registerCoreIpc(adapter, { ipc, targets: () => [destroyed, throwing, live] });
  return { handlers, adapter, live, destroyed, throwing, dispose, unsubscribe, emit: (event: BiomeEvent) => subscriber?.(event), consoleSpy };
}

describe('registerCoreIpc', () => {
  it('registers every method channel and passes its arguments to the matching adapter method', async () => {
    const f = fixture();
    const channels = Object.entries(IPC).filter(([key]) => key !== 'event');
    expect([...f.handlers.keys()]).toEqual(channels.map(([, channel]) => channel));
    for (const [key, channel] of channels) {
      const method = vi.fn().mockResolvedValue(key);
      (f.adapter as unknown as Record<string, unknown>)[key] = method;
      expect(await f.handlers.get(channel)?.({}, 'first', 17)).toBe(key);
      expect(method).toHaveBeenCalledWith('first', 17);
    }
    f.dispose(); f.consoleSpy.mockRestore();
  });

  it('fans out to live targets despite a throwing target, skips destroyed targets, and stops on dispose', () => {
    const f = fixture();
    const event = { id: 'e1', ts: 1, sessionId: 's1', type: 'agent.say', agentId: 'chipmunk', text: 'Hi', bubble: 'Hi', priority: 'chip' } as BiomeEvent;
    f.emit(event);
    expect(f.destroyed.send).not.toHaveBeenCalled();
    expect(f.throwing.send).toHaveBeenCalledWith(IPC.event, event);
    expect(f.live.send).toHaveBeenCalledWith(IPC.event, event);
    expect(f.consoleSpy).toHaveBeenCalledTimes(1);
    f.dispose();
    expect(f.handlers.size).toBe(0);
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    f.emit(event);
    expect(f.live.send).toHaveBeenCalledTimes(1);
    f.consoleSpy.mockRestore();
  });
});
