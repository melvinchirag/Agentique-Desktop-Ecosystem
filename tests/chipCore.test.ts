import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BiomeEvent } from '../src/shared/events';
import { EventBus } from '../src/main/bus/eventBus';
import { createChipCore, type ChipCore, type ChipCoreConfig, USER_BUSY_AFTER_MESSAGE_MS } from '../src/main/chipCore';
import { FakeClock } from '../src/main/runtime/clock';
import { MemoryHistoryStore } from '../src/main/runtime/history';
import { MemoryNudgeStore } from '../src/main/runtime/nudgeStore';
import type { EventSink, LlmClient, LlmResponse } from '../src/main/runtime/types';
import {
  completed, FakeCalendar, FakeLlm, FakeSpecialists, makeTestSettings, requiresAction, toolCall,
} from '../src/main/testing';

const SEC = 1000;
const MIN = 60 * SEC;
const NOON = new Date(2026, 9, 4, 12, 0);                // local noon, Sun Oct 4 2026
const EMPTY_PLAN = '{"nudges":[]}';

const hi = (): LlmResponse => completed('[bubble: Hi!]\nHey there! What are we up to today?');
const moodThenHi = (): LlmResponse[] => [
  requiresAction([toolCall('report_user_mood', { mood: 'happy', intensity: 0.5, reason: 'greeting' })]),
  hi(),
];

/** Answers every request with a short spoken line (nudge turns included). */
const alwaysHi: LlmClient = {
  async send() { return hi(); },
  async submitToolOutputs() { return hi(); },
};

class FakeSink implements EventSink {
  readonly enqueued: BiomeEvent[] = [];
  flush = vi.fn(async (): Promise<void> => {});
  enqueue(e: BiomeEvent): void {
    this.enqueued.push(e);
  }
}

const cores: ChipCore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cores.splice(0)) await c.dispose();
});

function makeCore(over: Partial<ChipCoreConfig> = {}) {
  const clock = (over.clock as FakeClock | undefined) ?? new FakeClock(NOON);
  const core = createChipCore({
    llm: new FakeLlm([]),
    runner: new FakeSpecialists({ clock }),
    calendar: new FakeCalendar(clock),
    settings: () => makeTestSettings(),
    chipAssistantId: 'chip-asst',
    timeZone: 'America/Detroit',
    startNudges: false,
    ...over,
    clock,
  });
  cores.push(core);
  const events = (): BiomeEvent[] => core.bus.recent();
  const ofType = <T extends BiomeEvent['type']>(t: T) => events().filter((e): e is Extract<BiomeEvent, { type: T }> => e.type === t);
  return { core, clock, events, ofType };
}

describe('createChipCore', () => {
  it('1. builds and runs: a user message reaches Chip, and the events reach the bus', async () => {
    const { core, ofType, events } = makeCore({ llm: new FakeLlm(moodThenHi()) });
    core.orchestrator.submitUserMessage('hi');
    await core.orchestrator.whenIdle();

    expect(ofType('user.message')).toHaveLength(1);
    expect(ofType('user.mood')[0]).toMatchObject({ mood: 'happy' });
    const spoken = ofType('agent.say').filter((e) => e.agentId === 'chipmunk' && e.priority === 'chip');
    expect(spoken).toEqual([expect.objectContaining({ bubble: 'Hi!', text: 'Hey there! What are we up to today?' })]);
    expect(events().some((e) => e.type === 'agent.status' && e.agentId === 'chipmunk' && e.status === 'idle')).toBe(true);
  });

  it('1b. sessionId reaches the bus', () => {
    const { core } = makeCore({ sessionId: 'session-xyz' });
    expect(core.bus.sessionId).toBe('session-xyz');
  });

  it('2. defaults: in-memory nudge and history stores are used and exposed', async () => {
    const { core } = makeCore();
    expect(core.nudgeStore).toBeInstanceOf(MemoryNudgeStore);
    expect(core.history).toBeInstanceOf(MemoryHistoryStore);
    expect(await core.history.query('recent_tasks', 24)).toEqual([]);
  });

  it('2b. a given nudgeStore and history are used as they are', () => {
    const nudgeStore = new MemoryNudgeStore();
    const clock = new FakeClock(NOON);
    const history = new MemoryHistoryStore({ bus: new EventBus({ clock }), clock });
    const { core } = makeCore({ clock, nudgeStore, history });
    expect(core.nudgeStore).toBe(nudgeStore);
    expect(core.history).toBe(history);
  });

  it('3. plannerLlm defaults to llm', async () => {
    const llm = new FakeLlm([completed(EMPTY_PLAN)]);
    const { clock } = makeCore({ llm, startNudges: true });
    await clock.advanceAsync(1 * SEC);

    expect(llm.calls).toHaveLength(1);
    const call = llm.calls[0]!;
    expect(call.kind === 'send' && call.params).toMatchObject({ assistantId: 'chip-asst', jsonOutput: true, memory: 'off' });
  });

  it('3b. a given plannerLlm does the planning and Chip\'s script is untouched', async () => {
    const llm = new FakeLlm([...moodThenHi()]);
    const plannerLlm = new FakeLlm([completed(EMPTY_PLAN)]);
    const { clock } = makeCore({ llm, plannerLlm, startNudges: true });
    await clock.advanceAsync(1 * SEC);

    expect(plannerLlm.calls).toHaveLength(1);
    expect(llm.calls).toHaveLength(0);
    expect(llm.remaining()).toBe(2);
  });

  it('4. eventSink: every bus event is enqueued in order; dispose() flushes once', async () => {
    const sink = new FakeSink();
    const { core, events } = makeCore({ llm: new FakeLlm(moodThenHi()), eventSink: sink });
    core.orchestrator.submitUserMessage('hi');
    await core.orchestrator.whenIdle();

    expect(events().length).toBeGreaterThan(3);
    expect(sink.enqueued.map((e) => e.id)).toEqual(events().map((e) => e.id));
    expect(sink.flush).not.toHaveBeenCalled();

    await core.dispose();
    expect(sink.flush).toHaveBeenCalledTimes(1);
    await core.dispose();
    expect(sink.flush).toHaveBeenCalledTimes(1);
  });

  it('4b. dispose() waits for the flush', async () => {
    let release!: () => void;
    const sink = new FakeSink();
    sink.flush = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const { core } = makeCore({ eventSink: sink });

    let done = false;
    const disposing = core.dispose().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await disposing;
    expect(done).toBe(true);
  });

  it('4c. a flush that rejects does not make dispose() reject', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new FakeSink();
    sink.flush = vi.fn(async () => { throw new Error('tiger is down'); });
    const { core } = makeCore({ eventSink: sink });

    await expect(core.dispose()).resolves.toBeUndefined();
    expect(sink.flush).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalled();
  });

  it('4d. a throwing sink does not break the bus', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new FakeSink();
    sink.enqueue = () => { throw new Error('sink exploded'); };
    const { core, ofType } = makeCore({ llm: new FakeLlm(moodThenHi()), eventSink: sink });
    core.orchestrator.submitUserMessage('hi');
    await core.orchestrator.whenIdle();
    expect(ofType('agent.say').some((e) => e.agentId === 'chipmunk')).toBe(true);
  });

  describe('5. isUserBusy', () => {
    it('is false when nothing is going on', () => {
      const { core } = makeCore();
      expect(core.isUserBusy()).toBe(false);
    });

    it('is true while the user is talking', () => {
      const { core } = makeCore();
      core.setUserTalking(true);
      expect(core.isUserBusy()).toBe(true);
      core.setUserTalking(false);
      expect(core.isUserBusy()).toBe(false);
    });

    it('is true during a Chip turn, even after the 20 s since the message have passed', async () => {
      let release!: (r: LlmResponse) => void;
      const llm = new FakeLlm([() => new Promise<LlmResponse>((resolve) => { release = resolve; })]);
      const { core, clock } = makeCore({ llm });

      core.orchestrator.submitUserMessage('hi');
      await clock.advanceAsync(USER_BUSY_AFTER_MESSAGE_MS + 1 * SEC);     // under Chip's own 25 s LLM timeout
      expect(core.isUserBusy()).toBe(true);                               // only the running turn explains this

      release(hi());
      await core.orchestrator.whenIdle();
      expect(core.isUserBusy()).toBe(false);
    });

    it('is true for 20 s after a user message, then false', async () => {
      const { core, clock } = makeCore({ llm: new FakeLlm(moodThenHi()) });
      core.orchestrator.submitUserMessage('hi');
      await core.orchestrator.whenIdle();
      expect(core.isUserBusy()).toBe(true);

      await clock.advanceAsync(USER_BUSY_AFTER_MESSAGE_MS - 1);
      expect(core.isUserBusy()).toBe(true);
      await clock.advanceAsync(1);
      expect(core.isUserBusy()).toBe(false);
    });

    it('is what the nudge engine sees: a due nudge waits while the user is holding Chip', async () => {
      const { core, clock, ofType } = makeCore({ llm: alwaysHi, startNudges: true });
      core.nudges.schedule({ kind: 'custom', source: 'chip', about: 'Study group', question: 'Ready?', askAt: new Date(NOON.getTime() + 5 * SEC) });

      core.setUserTalking(true);
      await clock.advanceAsync(2 * MIN);
      expect(ofType('nudge.fire')).toHaveLength(0);

      core.setUserTalking(false);
      await clock.advanceAsync(30 * SEC);
      expect(ofType('nudge.fire').some((e) => e.about === 'Study group')).toBe(true);
    });
  });

  it('6. DND: a due nudge is held, and fires at the next check once DND is off', async () => {
    const { core, clock, ofType } = makeCore({ llm: alwaysHi, startNudges: true });
    core.nudges.schedule({ kind: 'custom', source: 'chip', about: 'Study group', question: 'Ready?', askAt: new Date(NOON.getTime() + 10 * SEC) });

    core.setDoNotDisturb(true);
    await clock.advanceAsync(5 * MIN);
    expect(ofType('nudge.fire')).toHaveLength(0);
    expect(core.nudgeStore).toBeInstanceOf(MemoryNudgeStore);
    expect((core.nudgeStore as MemoryNudgeStore).all.find((n) => n.about === 'Study group')?.state).toBe('pending');

    core.setDoNotDisturb(false);
    await clock.advanceAsync(29 * SEC);
    expect(ofType('nudge.fire')).toHaveLength(0);                          // not before the next check
    await clock.advanceAsync(1 * SEC);
    const fired = ofType('nudge.fire');
    expect(fired.some((e) => e.about === 'Study group')).toBe(true);
    expect(fired.every((e) => e.ts === NOON.getTime() + 5 * MIN + 30 * SEC)).toBe(true);
  });

  it('7. startNudges: false schedules no rule nudges and never runs the planner', async () => {
    const plannerLlm = new FakeLlm([]);
    const { core, clock, ofType } = makeCore({ plannerLlm, startNudges: false });
    await clock.advanceAsync(3 * 60 * MIN);

    expect((core.nudgeStore as MemoryNudgeStore).all).toHaveLength(0);
    expect(plannerLlm.calls).toHaveLength(0);
    expect(ofType('nudge.fire')).toHaveLength(0);
  });

  it('7b. control: startNudges defaults to true (rule nudges exist after start)', async () => {
    const { core, clock } = makeCore({ plannerLlm: new FakeLlm([completed(EMPTY_PLAN)]), startNudges: undefined });
    await clock.advanceAsync(1 * SEC);
    expect((core.nudgeStore as MemoryNudgeStore).all.map((n) => n.kind).sort()).toEqual(['daily', 'evening', 'weekly']);
  });

  it('8. dispose() twice is safe, and afterwards the clock moving emits nothing', async () => {
    const sink = new FakeSink();
    const { core, clock, events } = makeCore({
      llm: alwaysHi, plannerLlm: new FakeLlm([completed(EMPTY_PLAN)]), startNudges: true, eventSink: sink,
    });
    await clock.advanceAsync(1 * SEC);

    await core.dispose();
    await expect(core.dispose()).resolves.toBeUndefined();

    const before = events().length;
    const sunk = sink.enqueued.length;
    await clock.advanceAsync(26 * 60 * MIN);                               // a whole day: idle, mood, nudge, planner timers
    expect(events()).toHaveLength(before);
    expect(sink.enqueued).toHaveLength(sunk);
    expect(clock.pending()).toBe(0);

    core.bus.emit({ type: 'user.message', text: 'late', source: 'text' } as never);   // the sink was unsubscribed
    expect(sink.enqueued).toHaveLength(sunk);
  });
});
