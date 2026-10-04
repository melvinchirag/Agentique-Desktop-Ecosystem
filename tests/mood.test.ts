import { describe, expect, it } from 'vitest';
import type { AgentId, Presence, UserMood } from '../src/shared/agents';
import { AGENTS } from '../src/shared/config';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock } from '../src/main/runtime/clock';
import { createMoodEngine, CONTAGION_ORDER } from '../src/main/runtime/mood';
import type { PresenceManager } from '../src/main/runtime/types';
import type { BiomeEvent } from '../src/shared/events';
import { makeTestSettings } from '../src/main/testing/settings';

function harness(installedAll = false) {
  const clock = new FakeClock();
  const bus = new EventBus({ clock });
  const events: BiomeEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const installed = Object.fromEntries(Object.keys(AGENTS).map((id) => [id, installedAll])) as Record<AgentId, boolean>;
  const settings = () => makeTestSettings(installedAll ? { installed } : {});
  const states = new Map<AgentId, Presence>([
    ['chipmunk', 'active'], ['workspace', 'active'], ['wolf', 'active'], ['beaver', 'active'], ['eagle', 'active'], ['ants', 'active'], ['butterfly', 'active'], ['nightingale', 'active'],
  ]);
  const presence: PresenceManager = {
    start() {}, get(id) { return states.get(id) ?? 'not_installed'; }, touch() {}, setBusy() {}, wake() { return Promise.resolve(); }, onChange() {}, dispose() {},
  };
  const mood = createMoodEngine({ bus, clock, settings, presence });
  const moods = () => events.filter((event) => event.type === 'agent.mood');
  return { clock, events, moods, mood, states };
}

describe('MoodEngine', () => {
  it('applies the C14 angry row immediately and in the specified contagion order, then decays', () => {
    const { clock, moods, mood } = harness(true);
    mood.onUserMood('angry', 0.9, 'rough day', 'task-1');
    expect(moods().map((event) => event.type === 'agent.mood' ? [event.agentId, event.mood] : [])).toEqual([['chipmunk', 'scared']]);
    clock.advance(399);
    expect(moods()).toHaveLength(1);
    clock.advance(1);
    expect(moods().at(-1)).toMatchObject({ agentId: 'workspace', mood: 'nervous', cause: 'chipmunk', taskId: 'task-1' });
    clock.advance(250);
    expect(moods().at(-1)).toMatchObject({ agentId: 'wolf', mood: 'protective' });
    clock.advance(250);
    expect(moods().at(-1)).toMatchObject({ agentId: 'beaver', mood: 'scared' });
    clock.advance(1000);
    expect(moods().slice(0, 8).map((event) => event.type === 'agent.mood' ? [event.agentId, event.mood] : [])).toEqual([
      ['chipmunk', 'scared'], ['workspace', 'nervous'], ['wolf', 'protective'], ['beaver', 'scared'],
      ['eagle', 'nervous'], ['ants', 'scared'], ['butterfly', 'scared'], ['nightingale', 'scared'],
    ]);
    clock.advance(18_100);
    expect(moods().filter((event) => event.type === 'agent.mood' && event.mood === 'neutral')).toHaveLength(8);
    expect(moods().slice(-8).every((event) => event.type === 'agent.mood' && event.mood === 'neutral')).toBe(true);
  });

  it('skips inactive animals without leaving a stagger gap', () => {
    const { clock, moods, mood, states } = harness();
    states.set('workspace', 'sleeping');
    mood.onUserMood('angry', 0.9, 'test');
    clock.advance(400);
    expect(moods().at(-1)).toMatchObject({ agentId: 'wolf', mood: 'protective' });
    clock.advance(250);
    expect(moods().at(-1)).toMatchObject({ agentId: 'beaver', mood: 'scared' });
  });

  it('keeps low intensity moods on Chip only unless the call is relief', () => {
    const { clock, moods, mood } = harness();
    mood.onUserMood('sad', 0.2, 'test');
    clock.advance(1000);
    expect(moods().map((event) => event.type === 'agent.mood' ? event.agentId : '')).toEqual(['chipmunk']);
  });

  it('spreads low intensity relief and cancels the previous contagion', () => {
    const { clock, moods, mood } = harness(true);
    mood.onUserMood('angry', 0.9, 'first');
    clock.advance(200);
    mood.onUserMood('calm', 0.2, 'relief');
    expect(moods().at(-1)).toMatchObject({ agentId: 'chipmunk', mood: 'relieved' });
    clock.advance(200);
    expect(moods().some((event) => event.type === 'agent.mood' && event.agentId === 'workspace')).toBe(false);
    clock.advance(200);
    expect(moods().at(-1)).toMatchObject({ agentId: 'workspace', mood: 'happy' });
    clock.advance(250);
    expect(moods().at(-1)).toMatchObject({ agentId: 'wolf', mood: 'proud' });
    clock.advance(250);
    expect(moods().at(-1)).toMatchObject({ agentId: 'beaver', mood: 'happy' });
    expect(moods().filter((event) => event.type === 'agent.mood' && event.mood === 'happy').length).toBeGreaterThan(1);
  });

  it('emits no duplicate mood events and tracks the latest user mood', () => {
    const { moods, mood } = harness();
    expect(mood.getUserMood()).toBe('calm');
    mood.onUserMood('happy', 0.5, 'one');
    const count = moods().length;
    mood.onUserMood('happy', 0.5, 'two');
    expect(mood.getUserMood()).toBe('happy');
    expect(moods().length).toBe(count);
  });

  it('restarts decay when another user mood arrives', () => {
    const { clock, moods, mood } = harness();
    mood.onUserMood('sad', 0.8, 'first');
    clock.advance(19_000);
    mood.onUserMood('stressed', 0.8, 'second');
    clock.advance(1000);
    expect(moods().some((event) => event.type === 'agent.mood' && event.mood === 'neutral')).toBe(false);
    clock.advance(19_000);
    expect(moods().some((event) => event.type === 'agent.mood' && event.agentId === 'chipmunk' && event.mood === 'neutral')).toBe(true);
  });

  it('does not spread to extras unless installed and disposes pending timers', () => {
    const { clock, moods, mood } = harness();
    expect(CONTAGION_ORDER).toEqual(['workspace', 'wolf', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale']);
    mood.onUserMood('happy' satisfies UserMood, 0.9, 'test');
    clock.advance(400 + 6 * 250);
    expect(moods().some((event) => event.type === 'agent.mood' && (event.agentId === 'butterfly' || event.agentId === 'nightingale'))).toBe(false);
    mood.dispose();
    expect(clock.pending()).toBe(0);
  });
});
