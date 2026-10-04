/**
 * Wave 1 cross-lane checks: the real JobScheduler, PresenceManager and MoodEngine together.
 * Each lane was tested against fakes; these catch contract mismatches between lanes
 * (e.g. setBusy holds must balance because PresenceManager counts them).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentId } from '../../src/shared/agents';
import type { BiomeEvent } from '../../src/shared/events';
import { EventBus } from '../../src/main/bus/eventBus';
import { FakeClock } from '../../src/main/runtime/clock';
import { createJobScheduler } from '../../src/main/runtime/jobs';
import { createMoodEngine } from '../../src/main/runtime/mood';
import { createPresenceManager, WAKE_FROM_DOCK_MS } from '../../src/main/runtime/presence';
import type { JobScheduler, MoodEngine, PresenceManager } from '../../src/main/runtime/types';
import { FakeSpecialists, fakeResult } from '../../src/main/testing';
import { DEMO_TIMERS, makeTestSettings } from '../../src/main/testing/settings';

const SEC = 1000;

let clock: FakeClock;
let bus: EventBus;
let presence: PresenceManager;
let specialists: FakeSpecialists;
let jobs: JobScheduler;
let mood: MoodEngine;

beforeEach(() => {
  clock = new FakeClock(0);
  bus = new EventBus({ clock, sessionId: 's' });
  const settings = () => makeTestSettings({ timers: DEMO_TIMERS });     // sleep 30 s, dock 60 s, mood 20 s
  presence = createPresenceManager({ bus, clock, settings });
  specialists = new FakeSpecialists({ clock, delayMs: 5 * SEC });
  jobs = createJobScheduler({ bus, clock, runner: specialists, presence, settings });
  mood = createMoodEngine({ bus, clock, settings, presence });
  presence.start();
});

const events = (): BiomeEvent[] => bus.recent();
const presenceOf = (id: AgentId) =>
  events().filter((e): e is Extract<BiomeEvent, { type: 'agent.presence' }> => e.type === 'agent.presence' && e.agentId === id);

const req = (agent: 'beaver' | 'eagle' | 'ants' | 'workspace', title: string, kind: 'normal' | 'help' = 'normal') => ({
  agent, task: title, title, requestedBy: (kind === 'help' ? 'workspace' : 'chipmunk') as AgentId, kind, parentTaskId: 't1',
});

describe('Wave 1 integration', () => {
  it('an animal stays awake through a job longer than the sleep timer, then sleeps 30 s after', async () => {
    specialists = new FakeSpecialists({ clock, delayMs: 90 * SEC });
    jobs = createJobScheduler({ bus, clock, runner: specialists, presence, settings: () => makeTestSettings({ timers: DEMO_TIMERS }) });
    jobs.submit(req('eagle', 'Long research'));
    await clock.advanceAsync(89 * SEC);
    expect(presence.get('eagle')).toBe('active');                        // would be asleep at 30 s without setBusy
    await clock.advanceAsync(1 * SEC);                                    // job done at 90 s
    await clock.advanceAsync(29 * SEC);
    expect(presence.get('eagle')).toBe('active');
    await clock.advanceAsync(1 * SEC);
    expect(presence.get('eagle')).toBe('sleeping');
  });

  it('overlapping normal + help jobs release every busy hold (the animal can still fall asleep)', async () => {
    specialists.setBehavior('beaver', () => fakeResult('beaver'));
    jobs.submit(req('beaver', 'Organize downloads'));                     // 5 s
    await clock.advanceAsync(2 * SEC);
    const help = jobs.submit(req('beaver', 'Find syllabus', 'help'));     // 5 s, overlaps
    expect(help.status).toBe('started');
    await clock.advanceAsync(10 * SEC);                                   // both finished
    expect(jobs.list().filter((j) => j.agent === 'beaver' && j.state === 'running')).toHaveLength(0);
    await clock.advanceAsync(30 * SEC);
    expect(presence.get('beaver')).toBe('sleeping');                      // would stay 'active' forever if a hold leaked
  });

  it('a job for a docked animal wakes it first, then runs (C10 end to end)', async () => {
    await clock.advanceAsync(30 * SEC + 60 * SEC);                        // everyone asleep, then docked
    expect(presence.get('ants')).toBe('docked');
    expect(presence.get('chipmunk')).toBe('sleeping');                    // Chip never docks

    const r = jobs.submit(req('ants', 'Plan the week'));
    expect(r.status).toBe('woke_and_started');
    await clock.advanceAsync(WAKE_FROM_DOCK_MS - 1);
    expect(specialists.runs).toHaveLength(0);                             // still walking back from the Hub
    await clock.advanceAsync(1);
    expect(specialists.runs).toHaveLength(1);

    const order = events()
      .filter((e) => (e.type === 'agent.presence' && e.agentId === 'ants' && e.presence === 'active' && e.reason === 'job')
        || (e.type === 'job.update' && e.to === 'ants' && e.state === 'running'))
      .map((e) => e.type);
    expect(order).toEqual(['agent.presence', 'job.update']);
  });

  it('cancelling a job for a sleeping animal leaves it able to sleep again', async () => {
    await clock.advanceAsync(30 * SEC);
    expect(presence.get('eagle')).toBe('sleeping');
    jobs.submit(req('eagle', 'Research'));
    await clock.advanceAsync(1 * SEC);
    jobs.cancel({ agent: 'eagle' });
    await clock.advanceAsync(30 * SEC);
    expect(presence.get('eagle')).toBe('sleeping');
  });

  it('mood contagion only reaches animals that are really active (real presence)', async () => {
    await clock.advanceAsync(30 * SEC);                                   // everyone asleep
    jobs.submit(req('workspace', 'Check email'));                         // wakes Pixel only
    await clock.advanceAsync(1);
    mood.onUserMood('angry', 0.9, 'all caps');
    await clock.advanceAsync(2 * SEC);
    const moods = events().filter((e): e is Extract<BiomeEvent, { type: 'agent.mood' }> => e.type === 'agent.mood');
    expect(moods.map((m) => `${m.agentId}:${m.mood}`)).toEqual(['chipmunk:scared', 'workspace:nervous']);
  });

  it('presence events are well-formed for every installed animal at startup', () => {
    const startup = events().filter((e) => e.type === 'agent.presence' && e.reason === 'startup').map((e) => e.agentId);
    expect(startup.sort()).toEqual(['ants', 'beaver', 'chipmunk', 'eagle', 'wolf', 'workspace']);
    expect(presenceOf('butterfly')).toHaveLength(0);
  });
});
