import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock } from '../src/main/runtime/clock';
import {
  buildPlannerPrompt, CHECK_EVERY_MS, createNudgeEngine, isQuietTime, PLANNER_RETRY_MS,
} from '../src/main/runtime/nudges';
import { MemoryNudgeStore } from '../src/main/runtime/nudgeStore';
import type { CalendarEvent, LlmClient, LlmResponse, Nudge, SendParams } from '../src/main/runtime/types';
import { makeTestSettings } from '../src/main/testing/settings';
import type { AdeSettings } from '../src/shared/ipc';

const MIN = 60_000;
const HOUR = 60 * MIN;

// Monday 2026-10-05, local time.
const at = (h: number, m = 0, day = 5): Date => new Date(2026, 9, day, h, m);

class StubLlm implements LlmClient {
  readonly calls: SendParams[] = [];
  respond: (p: SendParams, call: number) => string = () => JSON.stringify({ nudges: [] });
  async send(p: SendParams): Promise<LlmResponse> {
    this.calls.push(p);
    return { thread_id: 'planner-thread', content: this.respond(p, this.calls.length) };
  }
  async submitToolOutputs(): Promise<LlmResponse> {
    throw new Error('not used');
  }
}

function event(id: string, title: string, start: Date, end: Date): CalendarEvent {
  return { id, title, start, end };
}

interface Opts {
  start?: Date;
  settings?: Partial<AdeSettings>;
  events?: CalendarEvent[];
  /** Pretend today's daily check-in already happened so the rule nudge doesn't mix into the test. */
  seedDaily?: boolean;
  store?: MemoryNudgeStore;
  plans?: { completionToday(): Promise<{ text: string }> };
}

function setup(opts: Opts = {}) {
  const start = opts.start ?? at(10);
  const clock = new FakeClock(start);
  const bus = new EventBus({ clock });
  const store = opts.store ?? new MemoryNudgeStore();
  const llm = new StubLlm();
  const flags = { busy: false, dnd: false };
  let settings = makeTestSettings(opts.settings);
  const calendar = { events: opts.events ?? [], listEvents: async () => calendar.events };
  if (opts.seedDaily !== false) {
    const d = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    store.all.push({ id: 'seed-daily', kind: 'daily', about: 'daily check-in', question: 'seed', askAt: start, eventId: `rule:daily:${d}`, state: 'answered', source: 'rule' });
  }
  let n = 0;
  const engine = createNudgeEngine({
    bus, clock, store, llm, calendar,
    settings: () => settings,
    chipAssistantId: 'chip-assistant',
    isUserBusy: () => flags.busy,
    isDoNotDisturb: () => flags.dnd,
    newId: () => `n${++n}`,
    plans: opts.plans,
  });
  const batches: Nudge[][] = [];
  engine.onDue((b) => batches.push(b));
  const custom = (askAt: Date, question = 'How are you?'): string =>
    engine.schedule({ kind: 'custom', about: 'check-in', question, askAt, source: 'chip' });
  const state = (id: string) => store.all.find((x) => x.id === id)?.state;
  return {
    clock, bus, store, llm, engine, flags, calendar, batches, custom, state,
    setSettings: (patch: Partial<AdeSettings>) => { settings = makeTestSettings({ ...settings, ...patch }); },
  };
}

describe('MemoryNudgeStore', () => {
  const nudge = (id: string, askAt: Date, state: Nudge['state'] = 'pending', eventId?: string): Nudge =>
    ({ id, kind: 'before', about: 'x', question: 'q', askAt, state, source: 'planner', eventId });

  it('due() returns pending and snoozed nudges at or before now, oldest first', async () => {
    const s = new MemoryNudgeStore();
    await s.insert(nudge('late', at(12)));
    await s.insert(nudge('early', at(9)));
    await s.insert(nudge('snoozed', at(10), 'snoozed'));
    await s.insert(nudge('fired', at(8), 'fired'));
    await s.insert(nudge('future', at(15)));
    expect((await s.due(at(12))).map((n) => n.id)).toEqual(['early', 'snoozed', 'late']);
  });

  it('findByEvent ignores cancelled nudges, and the store copies rather than shares', async () => {
    const s = new MemoryNudgeStore();
    const original = nudge('a', at(9), 'cancelled', 'ev1');
    await s.insert(original);
    expect(await s.findByEvent('ev1', 'before')).toBeNull();
    await s.insert(nudge('b', at(9), 'pending', 'ev1'));
    const found = await s.findByEvent('ev1', 'before');
    expect(found?.id).toBe('b');
    expect(await s.findByEvent('ev1', 'after')).toBeNull();
    found!.question = 'changed';
    found!.askAt.setHours(1);
    expect(s.all[1]!.question).toBe('q');
    expect(s.all[1]!.askAt.getHours()).toBe(9);
    original.state = 'pending';
    expect(s.all[0]!.state).toBe('cancelled');
  });

  it('update patches a stored nudge', async () => {
    const s = new MemoryNudgeStore();
    await s.insert(nudge('a', at(9)));
    await s.update('a', { state: 'snoozed', askAt: at(11) });
    expect(s.all[0]).toMatchObject({ state: 'snoozed' });
    expect(s.all[0]!.askAt.getTime()).toBe(at(11).getTime());
    await s.update('missing', { state: 'fired' });
  });
});

describe('isQuietTime', () => {
  it('handles a range over midnight (23:00-08:00)', () => {
    expect(isQuietTime(at(23, 0), '23:00', '08:00')).toBe(true);
    expect(isQuietTime(at(2, 30), '23:00', '08:00')).toBe(true);
    expect(isQuietTime(at(7, 59), '23:00', '08:00')).toBe(true);
    expect(isQuietTime(at(8, 0), '23:00', '08:00')).toBe(false);
    expect(isQuietTime(at(12, 0), '23:00', '08:00')).toBe(false);
    expect(isQuietTime(at(22, 59), '23:00', '08:00')).toBe(false);
  });

  it('handles a same-day range (13:00-14:00)', () => {
    expect(isQuietTime(at(13, 0), '13:00', '14:00')).toBe(true);
    expect(isQuietTime(at(13, 59), '13:00', '14:00')).toBe(true);
    expect(isQuietTime(at(14, 0), '13:00', '14:00')).toBe(false);
    expect(isQuietTime(at(12, 59), '13:00', '14:00')).toBe(false);
    expect(isQuietTime(at(2, 0), '13:00', '14:00')).toBe(false);
  });
});

describe('planner', () => {
  it('C12: an exam ending soon gets an "after" nudge that fires 1 h later with the planner question', async () => {
    const exam = event('exam1', 'CS 280 Midterm', at(9, 0), at(10, 5));
    const t = setup({ events: [exam] });
    const question = 'Your CS 280 midterm ended an hour ago. How did it go?';
    t.llm.respond = () => JSON.stringify({
      nudges: [{ eventId: 'exam1', kind: 'after', askAt: at(11, 5).toISOString(), question, about: 'CS 280 midterm' }],
    });
    t.engine.start();
    await t.clock.advanceAsync(64 * MIN);
    expect(t.batches).toHaveLength(0);
    await t.clock.advanceAsync(2 * MIN);

    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]).toHaveLength(1);
    expect(t.batches[0]![0]).toMatchObject({ kind: 'after', question, about: 'CS 280 midterm', eventId: 'exam1', source: 'planner', state: 'fired' });
    const fires = t.bus.recent().filter((e) => e.type === 'nudge.fire');
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ agentId: 'chipmunk',kind: 'after', about: 'CS 280 midterm', nudgeId: t.batches[0]![0]!.id });
    expect(fires[0]!.taskId).toBeUndefined();
    expect(t.state(t.batches[0]![0]!.id)).toBe('fired');
  });

  it('sends a fresh-thread, memory-off, JSON request with the Chip assistant and no tools', async () => {
    const t = setup({ events: [event('e1', 'Final exam', at(14), at(16))] });
    t.engine.start();
    await t.clock.advanceAsync(0);
    expect(t.llm.calls).toHaveLength(1);
    const call = t.llm.calls[0]!;
    expect(call.assistantId).toBe('chip-assistant');
    expect(call.threadId).toBeUndefined();
    expect(call.memory).toBe('off');
    expect(call.jsonOutput).toBe(true);
    expect(call.tools).toBeUndefined();
    expect(call.content).toContain('Final exam');
    expect(call.content).toContain('"e1"');
  });

  it('does not call the model when the calendar is empty', async () => {
    const t = setup();
    t.engine.start();
    await t.clock.advanceAsync(0);
    expect(t.llm.calls).toHaveLength(0);
  });

  it('dedupes: the same planner output twice schedules once', async () => {
    const t = setup({ events: [event('e1', 'Interview', at(9, 0, 6), at(10, 0, 6))] });
    t.llm.respond = () => JSON.stringify({
      nudges: [
        { eventId: 'e1', kind: 'before', askAt: at(18, 0, 5).toISOString(), question: 'Ready for tomorrow?', about: 'interview' },
        { eventId: 'e1', kind: 'before', askAt: at(18, 30, 5).toISOString(), question: 'Duplicate in same reply', about: 'interview' },
      ],
    });
    t.engine.start();
    await t.clock.advanceAsync(0);
    expect(t.store.all.filter((n) => n.source === 'planner')).toHaveLength(1);
    await t.clock.advanceAsync(15 * HOUR);   // past the midnight re-run
    expect(t.llm.calls).toHaveLength(2);
    expect(t.store.all.filter((n) => n.source === 'planner')).toHaveLength(1);
  });

  it('skips unknown events, bad kinds, bad or past times, and malformed items', async () => {
    const t = setup({ events: [event('e1', 'Exam', at(14), at(16))] });
    const good = { eventId: 'e1', kind: 'after', askAt: at(17).toISOString(), question: 'How was it?', about: 'exam' };
    t.llm.respond = () => JSON.stringify({
      nudges: [
        { ...good, eventId: 'nope' },
        { ...good, kind: 'during' },
        { ...good, askAt: 'next tuesday-ish' },
        { ...good, askAt: at(9).toISOString() },
        { ...good, question: '' },
        null,
        'junk',
        good,
      ],
    });
    t.engine.start();
    await t.clock.advanceAsync(0);
    const planned = t.store.all.filter((n) => n.source === 'planner');
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ eventId: 'e1', kind: 'after', state: 'pending' });
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const t = setup({ events: [event('e1', 'Exam', at(14), at(16))] });
    const body = JSON.stringify({ nudges: [{ eventId: 'e1', kind: 'after', askAt: at(17).toISOString(), question: 'How was it?', about: 'exam' }] });
    t.llm.respond = () => '```json\n' + body + '\n```';
    t.engine.start();
    await t.clock.advanceAsync(0);
    expect(t.store.all.filter((n) => n.source === 'planner')).toHaveLength(1);
  });

  it('retries after 1 h when the model throws, and rule nudges still fire meanwhile', async () => {
    const t = setup({ events: [event('e1', 'Exam', at(14), at(16))] });
    t.llm.respond = (_p, call) => {
      if (call === 1) throw new Error('backboard down');
      return JSON.stringify({ nudges: [{ eventId: 'e1', kind: 'after', askAt: at(17).toISOString(), question: 'How was it?', about: 'exam' }] });
    };
    t.engine.start();
    await t.clock.advanceAsync(PLANNER_RETRY_MS - MIN);
    expect(t.llm.calls).toHaveLength(1);
    expect(t.store.all.filter((n) => n.source === 'planner')).toHaveLength(0);
    await t.clock.advanceAsync(MIN);
    expect(t.llm.calls).toHaveLength(2);
    expect(t.store.all.filter((n) => n.source === 'planner')).toHaveLength(1);

    await t.clock.advanceAsync(10 * HOUR);   // to 21:00; the 8 PM wrap-up went out regardless
    expect(t.batches.flat().some((n) => n.kind === 'evening')).toBe(true);
  });

  it('retries after 1 h on bad JSON, and keeps retrying', async () => {
    const t = setup({ events: [event('e1', 'Exam', at(14), at(16))] });
    t.llm.respond = () => 'sorry, I cannot do that';
    t.engine.start();
    await t.clock.advanceAsync(2 * PLANNER_RETRY_MS + MIN);
    expect(t.llm.calls).toHaveLength(3);
    expect(t.store.all.filter((n) => n.source === 'planner')).toHaveLength(0);
  });

  it('buildPlannerPrompt carries the rules, the events as ISO JSON, the time, and the output shape', () => {
    const now = at(10);
    const prompt = buildPlannerPrompt([event('abc', 'Bio exam', at(14), at(16))], now);
    for (const word of ['exams', 'interviews', 'deadlines', 'presentations', 'games', 'trips', 'appointments', 'routine']) {
      expect(prompt).toContain(word);
    }
    expect(prompt).toContain(JSON.stringify({ id: 'abc', title: 'Bio exam', start: at(14).toISOString(), end: at(16).toISOString() }));
    expect(prompt).toContain(now.toISOString());
    expect(prompt).toContain('"nudges"');
    expect(prompt).toContain('"eventId"');
    expect(prompt).toContain('"before" | "after"');
  });
});

describe('check loop manners', () => {
  it('C13: a nudge due at 23:30 is held all night and fires at the first check after 08:00', async () => {
    const t = setup({ start: at(22, 0) });
    const id = t.custom(at(23, 30));
    t.engine.start();
    await t.clock.advanceAsync(10 * HOUR - CHECK_EVERY_MS);   // 07:59:30
    expect(t.batches).toHaveLength(0);
    expect(t.state(id)).toBe('pending');
    await t.clock.advanceAsync(CHECK_EVERY_MS);               // 08:00:00
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]!.map((n) => n.id)).toContain(id);
    expect(t.clock.now()).toBe(at(8, 0, 6).getTime());
  });

  it('rate limit: 3 batches per rolling hour, held nudges go out together once the oldest batch is 60 min old', async () => {
    const t = setup();
    for (const m of [5, 10, 15, 20, 25]) t.custom(at(10, m));
    t.engine.start();
    await t.clock.advanceAsync(59 * MIN + 30_000);   // 10:59:30
    expect(t.batches.map((b) => b.length)).toEqual([1, 1, 1]);
    await t.clock.advanceAsync(5 * MIN);             // 11:04:30, oldest batch (10:05) is 59.5 min old
    expect(t.batches).toHaveLength(3);
    await t.clock.advanceAsync(30_000);              // 11:05:00
    expect(t.batches.map((b) => b.length)).toEqual([1, 1, 1, 2]);
    expect(t.batches[3]!.map((n) => n.askAt.getMinutes())).toEqual([20, 25]);
  });

  it('busy, do-not-disturb and nudges-off each hold, then release', async () => {
    const t = setup();
    t.custom(at(10, 2));
    t.flags.busy = true;
    t.engine.start();
    await t.clock.advanceAsync(5 * MIN);
    expect(t.batches).toHaveLength(0);
    t.flags.busy = false;
    t.flags.dnd = true;
    await t.clock.advanceAsync(5 * MIN);
    expect(t.batches).toHaveLength(0);
    t.flags.dnd = false;
    t.setSettings({ nudges: { enabled: false, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 3 } });
    await t.clock.advanceAsync(5 * MIN);
    expect(t.batches).toHaveLength(0);
    t.setSettings({ nudges: { enabled: true, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 3 } });
    await t.clock.advanceAsync(CHECK_EVERY_MS);
    expect(t.batches).toHaveLength(1);
  });

  it('a throwing onDue callback does not stop the others', async () => {
    const t = setup();
    t.engine.onDue(() => { throw new Error('boom'); });
    const seen: number[] = [];
    t.engine.onDue((b) => seen.push(b.length));
    t.custom(at(10, 1));
    t.engine.start();
    await t.clock.advanceAsync(2 * MIN);
    expect(t.batches).toHaveLength(1);
    expect(seen).toEqual([1]);
  });

  it('dispose stops the loop', async () => {
    const t = setup();
    t.custom(at(10, 1));
    t.engine.start();
    t.engine.dispose();
    await t.clock.advanceAsync(HOUR);
    expect(t.batches).toHaveLength(0);
    expect(t.clock.pending()).toBe(0);
  });
});

describe('snooze, cancel, answered', () => {
  it('snooze(id, 120) fires again 2 h later', async () => {
    const t = setup();
    const id = t.custom(at(10, 1));
    t.engine.start();
    await t.clock.advanceAsync(2 * MIN);
    expect(t.batches).toHaveLength(1);
    t.engine.snooze(id, 120);                       // now 10:02
    await t.clock.advanceAsync(0);
    expect(t.state(id)).toBe('snoozed');
    expect(t.store.all.find((n) => n.id === id)!.askAt.getTime()).toBe(at(12, 2).getTime());
    await t.clock.advanceAsync(2 * HOUR - 30_000);  // 12:01:30
    expect(t.batches).toHaveLength(1);
    await t.clock.advanceAsync(30_000);             // 12:02:00
    expect(t.batches).toHaveLength(2);
    expect(t.batches[1]![0]!.id).toBe(id);
  });

  it('cancel means it never fires', async () => {
    const t = setup();
    const id = t.custom(at(10, 5));
    t.engine.start();
    t.engine.cancel(id);
    await t.clock.advanceAsync(HOUR);
    expect(t.batches).toHaveLength(0);
    expect(t.state(id)).toBe('cancelled');
  });

  it('markAnswered sets state answered and it does not fire again', async () => {
    const t = setup();
    const id = t.custom(at(10, 1));
    t.engine.start();
    await t.clock.advanceAsync(2 * MIN);
    t.engine.markAnswered(id);
    await t.clock.advanceAsync(HOUR);
    expect(t.state(id)).toBe('answered');
    expect(t.batches).toHaveLength(1);
  });
});

describe('fireNextNow', () => {
  it('C: fires the earliest pending nudge at 02:00, ignoring quiet hours', async () => {
    const t = setup({ start: at(2, 0, 6), seedDaily: false });
    const later = t.custom(at(6, 0, 6), 'later');
    const first = t.custom(at(5, 0, 6), 'first');
    t.engine.start();
    await t.clock.advanceAsync(0);
    expect(t.batches).toHaveLength(0);
    t.engine.fireNextNow();
    await t.clock.advanceAsync(0);
    expect(t.batches).toHaveLength(1);
    expect(t.batches[0]!.map((n) => n.id)).toEqual([first]);
    expect(t.state(first)).toBe('fired');
    expect(t.state(later)).toBe('pending');
    expect(t.bus.recent().filter((e) => e.type === 'nudge.fire')).toHaveLength(1);
  });

  it('picks snoozed nudges too, ignores busy/DND, does nothing when empty, and counts toward the rate limit', async () => {
    const t = setup({ settings: { nudges: { enabled: true, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 1 } } });
    t.engine.fireNextNow();                         // nothing scheduled yet: no-op
    await t.clock.advanceAsync(0);
    expect(t.batches).toHaveLength(0);
    t.engine.start();
    await t.clock.advanceAsync(0);
    t.store.all.forEach((n) => t.engine.cancel(n.id));       // retire the rule nudges so only mine remain

    t.flags.busy = true;
    t.flags.dnd = true;
    const a = t.custom(at(15));
    t.engine.snooze(a, 300);
    t.engine.fireNextNow();
    await t.clock.advanceAsync(0);
    expect(t.batches.map((b) => b[0]!.id)).toEqual([a]);

    t.flags.busy = false;
    t.flags.dnd = false;
    const b = t.custom(at(10, 3));
    await t.clock.advanceAsync(30 * MIN);           // maxPerHour 1 already used by the hotkey
    expect(t.batches).toHaveLength(1);
    await t.clock.advanceAsync(31 * MIN);
    expect(t.batches).toHaveLength(2);
    expect(t.batches[1]![0]!.id).toBe(b);
  });
});

describe('rule nudges', () => {
  const rules = (t: ReturnType<typeof setup>) => t.store.all.filter((n) => n.source === 'rule' && n.state !== 'answered');

  it('includes Swarm completion in the evening wrap-up', async () => {
    const t = setup({ start: at(19), plans: { completionToday: async () => ({ text: '3 of 4 done' }) } });
    t.engine.start();
    await t.clock.advanceAsync(0);
    await t.clock.advanceAsync(HOUR);
    expect(t.batches.flat().find(n => n.kind === 'evening')?.question).toContain('3 of 4 done');
  });

  it('started at 09:00: daily now, evening at 20:00, weekly next Sunday 18:00', async () => {
    const t = setup({ start: at(9), seedDaily: false });
    t.engine.start();
    await t.clock.advanceAsync(0);
    const byKind = Object.fromEntries(rules(t).map((n) => [n.kind, n]));
    expect(byKind.daily).toMatchObject({ question: 'Morning! Want the rundown for today?', about: 'daily check-in' });
    expect(byKind.daily!.askAt.getTime()).toBe(at(9).getTime());
    expect(byKind.evening).toMatchObject({ question: "Wrap-up time. How'd today go? Anything to move to tomorrow?", about: 'evening wrap-up' });
    expect(byKind.evening!.askAt.getTime()).toBe(at(20).getTime());
    expect(byKind.weekly).toMatchObject({ question: 'Big week ahead. Want a plan?', about: 'weekly plan' });
    expect(byKind.weekly!.askAt.getTime()).toBe(new Date(2026, 9, 11, 18, 0).getTime());
    expect(rules(t)).toHaveLength(3);
  });

  it('the daily check-in goes out at the first check and schedules tomorrow 08:00; the evening one then schedules tomorrow 20:00', async () => {
    const t = setup({ start: at(9), seedDaily: false });
    t.engine.start();
    await t.clock.advanceAsync(CHECK_EVERY_MS);
    expect(t.batches.flat().map((n) => n.kind)).toEqual(['daily']);
    expect(t.store.all.some((n) => n.kind === 'daily' && n.state === 'pending' && n.askAt.getTime() === at(8, 0, 6).getTime())).toBe(true);

    await t.clock.advanceAsync(11 * HOUR);          // 20:00:30
    expect(t.batches.flat().map((n) => n.kind)).toEqual(['daily', 'evening']);
    const pendingEvenings = t.store.all.filter((n) => n.kind === 'evening' && n.state === 'pending');
    expect(pendingEvenings).toHaveLength(1);
    expect(pendingEvenings[0]!.askAt.getTime()).toBe(at(20, 0, 6).getTime());
  });

  it('before 08:00 the daily nudge waits for quiet hours to end; past 20:00 the evening one is for tomorrow', async () => {
    const t = setup({ start: at(6, 0), seedDaily: false });
    t.engine.start();
    await t.clock.advanceAsync(0);
    expect(t.store.all.find((n) => n.kind === 'daily')!.askAt.getTime()).toBe(at(8, 0).getTime());

    const late = setup({ start: at(21, 0), seedDaily: false });
    late.engine.start();
    await late.clock.advanceAsync(0);
    expect(late.store.all.find((n) => n.kind === 'evening')!.askAt.getTime()).toBe(at(20, 0, 6).getTime());
    expect(late.store.all.find((n) => n.kind === 'daily')!.askAt.getTime()).toBe(at(21, 0).getTime());
  });

  it('weekly: Sunday morning means today 18:00, Sunday evening means next Sunday', async () => {
    const sunMorning = setup({ start: at(9, 0, 4), seedDaily: false });
    sunMorning.engine.start();
    await sunMorning.clock.advanceAsync(0);
    expect(sunMorning.store.all.find((n) => n.kind === 'weekly')!.askAt.getTime()).toBe(at(18, 0, 4).getTime());

    const sunNight = setup({ start: at(19, 0, 4), seedDaily: false });
    sunNight.engine.start();
    await sunNight.clock.advanceAsync(0);
    expect(sunNight.store.all.find((n) => n.kind === 'weekly')!.askAt.getTime()).toBe(at(18, 0, 11).getTime());
  });

  it('a second engine on the same store does not duplicate rule nudges', async () => {
    const store = new MemoryNudgeStore();
    const a = setup({ start: at(9), seedDaily: false, store });
    a.engine.start();
    await a.clock.advanceAsync(0);
    const count = store.all.length;
    const b = setup({ start: at(9), seedDaily: false, store });
    b.engine.start();
    await b.clock.advanceAsync(0);
    expect(store.all).toHaveLength(count);
  });
});
