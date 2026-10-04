import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import type { BiomeEvent } from '../src/shared/events';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const say = (text: string) =>
  ({ type: 'agent.say', agentId: 'chipmunk', text, bubble: 'Hi', priority: 'chip' }) as const;

describe('EventBus', () => {
  it('fills id, ts and sessionId', () => {
    let t = 1000;
    const bus = new EventBus({ sessionId: 's-1', clock: { now: () => t } });
    const a = bus.emit(say('one'));
    t = 2000;
    const b = bus.emit(say('two'));
    expect(a.id).toMatch(UUID);
    expect(b.id).not.toBe(a.id);
    expect(a.ts).toBe(1000);
    expect(b.ts).toBe(2000);
    expect(a.sessionId).toBe('s-1');
    expect(a).toMatchObject({ type: 'agent.say', agentId: 'chipmunk', text: 'one' });
  });

  it('generates one sessionId per bus when none is given', () => {
    const bus = new EventBus();
    expect(bus.sessionId).toMatch(UUID);
    expect(bus.emit(say('x')).sessionId).toBe(bus.sessionId);
  });

  it('fans out synchronously to every subscriber', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(`a:${e.type}`));
    bus.subscribe((e) => seen.push(`b:${e.type}`));
    bus.emit(say('x'));
    expect(seen).toEqual(['a:agent.say', 'b:agent.say']);
  });

  it("a throwing subscriber doesn't stop the others", () => {
    const onSubscriberError = vi.fn();
    const bus = new EventBus({ onSubscriberError });
    const after = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(after);
    const e = bus.emit(say('x'));
    expect(after).toHaveBeenCalledWith(e);
    expect(onSubscriberError).toHaveBeenCalledOnce();
    expect(onSubscriberError.mock.calls[0]![1]).toBe(e);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    const off = bus.subscribe(cb);
    bus.emit(say('1'));
    off();
    bus.emit(say('2'));
    expect(cb).toHaveBeenCalledOnce();
  });

  it('a subscriber added during fan-out only sees later events', () => {
    const bus = new EventBus();
    const late = vi.fn();
    bus.subscribe(() => {
      bus.subscribe(late);
    });
    bus.emit(say('1'));
    expect(late).not.toHaveBeenCalled();
    bus.emit(say('2'));
    expect(late).toHaveBeenCalledOnce();
  });

  it('keeps a ring of the last 500 events, oldest first', () => {
    const bus = new EventBus();
    for (let i = 0; i < 510; i++) bus.emit(say(String(i)));
    const all = bus.recent();
    expect(all).toHaveLength(500);
    expect((all[0] as Extract<BiomeEvent, { type: 'agent.say' }>).text).toBe('10');
    expect((all[499] as Extract<BiomeEvent, { type: 'agent.say' }>).text).toBe('509');
  });

  it('recent(limit) returns the newest N and a copy', () => {
    const bus = new EventBus({ ringSize: 5 });
    for (let i = 0; i < 3; i++) bus.emit(say(String(i)));
    const last2 = bus.recent(2).map((e) => (e as Extract<BiomeEvent, { type: 'agent.say' }>).text);
    expect(last2).toEqual(['1', '2']);
    bus.recent().length = 0;
    expect(bus.recent()).toHaveLength(3);
  });
});
