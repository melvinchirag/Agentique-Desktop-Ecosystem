import { describe, expect, it } from 'vitest';
import { AGENTS } from '../src/shared/config';
import type { AgentId } from '../src/shared/agents';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock } from '../src/main/runtime/clock';
import { createPresenceManager, WAKE_FROM_DOCK_MS } from '../src/main/runtime/presence';
import type { BiomeEvent } from '../src/shared/events';
import { DEMO_TIMERS, makeTestSettings } from '../src/main/testing/settings';

function harness(timers = DEMO_TIMERS) {
  const clock = new FakeClock();
  const bus = new EventBus({ clock });
  const events: BiomeEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const settings = () => makeTestSettings({ timers });
  const presence = createPresenceManager({ bus, clock, settings });
  return { clock, events, presence };
}

describe('PresenceManager', () => {
  it('starts the six installed core animals as active', () => {
    const { events, presence } = harness();
    presence.start();
    const started = events.filter((event) => event.type === 'agent.presence');
    expect(started).toHaveLength(6);
    expect(started.map((event) => [event.agentId, event.type === 'agent.presence' ? event.presence : '']).sort()).toEqual(
      Object.values(AGENTS).filter((agent) => agent.tier === 'core').map((agent) => [agent.id, 'active']).sort(),
    );
    expect(presence.get('butterfly')).toBe('not_installed');
  });

  it('uses demo timers for sleep and dock transitions', () => {
    const { clock, events, presence } = harness();
    presence.start();
    clock.advance(29_999);
    expect(presence.get('workspace')).toBe('active');
    clock.advance(1);
    expect(presence.get('workspace')).toBe('sleeping');
    clock.advance(59_999);
    expect(presence.get('workspace')).toBe('sleeping');
    clock.advance(1);
    expect(presence.get('workspace')).toBe('docked');
    expect(events.filter((event) => event.type === 'agent.presence' && event.agentId === 'workspace').map((event) => event.type === 'agent.presence' ? [event.presence, event.reason] : [])).toEqual([
      ['active', 'startup'], ['sleeping', 'idle_timeout'], ['docked', 'dock_timeout'],
    ]);
  });

  it('lets Chip sleep without docking', () => {
    const { clock, presence } = harness();
    presence.start();
    clock.advance(60 * 60 * 1000);
    expect(presence.get('chipmunk')).toBe('sleeping');
  });

  it('restarts the active sleep timer when touched', () => {
    const { clock, presence } = harness();
    presence.start();
    clock.advance(20_000);
    presence.touch('workspace');
    clock.advance(29_999);
    expect(presence.get('workspace')).toBe('active');
    clock.advance(1);
    expect(presence.get('workspace')).toBe('sleeping');
  });

  it('holds busy animals awake and counts overlapping jobs', () => {
    const { clock, presence } = harness();
    presence.start();
    presence.setBusy('workspace', true);
    clock.advance(10 * 60 * 1000);
    expect(presence.get('workspace')).toBe('active');
    presence.setBusy('workspace', true);
    presence.setBusy('workspace', false);
    clock.advance(30_000);
    expect(presence.get('workspace')).toBe('active');
    presence.setBusy('workspace', false);
    clock.advance(29_999);
    expect(presence.get('workspace')).toBe('active');
    clock.advance(1);
    expect(presence.get('workspace')).toBe('sleeping');
  });

  it('wakes from sleep immediately and shares a dock return', async () => {
    const { clock, events, presence } = harness();
    presence.start();
    clock.advance(30_000);
    await presence.wake('workspace', 'user');
    expect(presence.get('workspace')).toBe('active');
    clock.advance(90_000);
    expect(presence.get('workspace')).toBe('docked');
    const beforeWake = events.filter((event) => event.type === 'agent.presence' && event.agentId === 'workspace').length;
    const first = presence.wake('workspace', 'job');
    const second = presence.wake('workspace', 'user');
    expect(first).toBe(second);
    let resolved = false;
    void first.then(() => { resolved = true; });
    clock.advance(WAKE_FROM_DOCK_MS - 1);
    await Promise.resolve();
    expect(resolved).toBe(false);
    clock.advance(1);
    await first;
    expect(resolved).toBe(true);
    expect(events.filter((event) => event.type === 'agent.presence' && event.agentId === 'workspace')).toHaveLength(beforeWake + 1);

    const sleepingWake = presence.wake('workspace', 'user');
    await sleepingWake;
    expect(presence.get('workspace')).toBe('active');
  });

  it('ignores calls for animals that are not installed and clears timers on dispose', () => {
    const { clock, events, presence } = harness();
    presence.start();
    const before = events.length;
    presence.touch('butterfly');
    presence.setBusy('butterfly', true);
    void presence.wake('butterfly', 'user');
    expect(presence.get('butterfly')).toBe('not_installed');
    expect(events).toHaveLength(before);
    presence.dispose();
    expect(clock.pending()).toBe(0);
  });
});
