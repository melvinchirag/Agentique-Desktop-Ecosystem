import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock } from '../src/main/runtime/clock';
import type { AgentResult, SpecialistRunContext } from '../src/main/runtime/types';
import {
  FakeCalendar,
  FakeLlm,
  FakeSpecialists,
  StubWardenGate,
  completed,
  fakeResult,
  makeTestSettings,
  requiresAction,
  toolCall,
} from '../src/main/testing';

const MIN = 60_000;

describe('FakeLlm', () => {
  it('consumes steps in order and records send + toolOutputs', async () => {
    const llm = new FakeLlm([requiresAction([toolCall('delegate', { agent: 'eagle' }, 'c1')]), completed('All done', 'thread-9', ['likes tea'])]);
    const first = await llm.send({ assistantId: 'a1', content: 'hi' });
    expect(first.status).toBe('REQUIRES_ACTION');
    expect(first.tool_calls?.[0]?.id).toBe('c1');
    const second = await llm.submitToolOutputs('thread-1', [{ tool_call_id: 'c1', output: 'ok' }]);
    expect(second).toMatchObject({ status: 'COMPLETED', content: 'All done', thread_id: 'thread-9', retrieved_memories: ['likes tea'] });
    expect(llm.calls).toEqual([
      { kind: 'send', params: { assistantId: 'a1', content: 'hi' } },
      { kind: 'toolOutputs', threadId: 'thread-1', outputs: [{ tool_call_id: 'c1', output: 'ok' }] },
    ]);
    expect(llm.remaining()).toBe(0);
  });

  it('push adds more steps; function steps receive the call', async () => {
    const llm = new FakeLlm();
    llm.push((call) => completed(call.kind === 'send' ? `echo ${call.params.content}` : 'nope'));
    llm.push(async () => completed('async'));
    expect(llm.remaining()).toBe(2);
    expect((await llm.send({ assistantId: 'a', content: 'yo' })).content).toBe('echo yo');
    expect((await llm.send({ assistantId: 'a', content: 'x' })).content).toBe('async');
  });

  it('throws Error steps and moves on to the next step', async () => {
    const llm = new FakeLlm([new Error('backboard down'), completed('back')]);
    await expect(llm.send({ assistantId: 'a', content: 'x' })).rejects.toThrow('backboard down');
    expect((await llm.send({ assistantId: 'a', content: 'x' })).content).toBe('back');
  });

  it('throws when the script is exhausted', async () => {
    const llm = new FakeLlm();
    await expect(llm.send({ assistantId: 'a', content: 'x' })).rejects.toThrow('FakeLlm: script exhausted');
    await expect(llm.submitToolOutputs('t', [])).rejects.toThrow('FakeLlm: script exhausted');
  });

  it('rejects an aborted signal with AbortError without consuming a step', async () => {
    const llm = new FakeLlm([completed('kept')]);
    const ac = new AbortController();
    ac.abort();
    await expect(llm.send({ assistantId: 'a', content: 'x', signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(llm.submitToolOutputs('t', [], ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(llm.remaining()).toBe(1);
    expect((await llm.send({ assistantId: 'a', content: 'x' })).content).toBe('kept');
  });

  it('toolCall stringifies args, default ids are unique, thread defaults to thread-1', () => {
    const a = toolCall('report_user_mood', { mood: 'calm', intensity: 0.2 });
    const b = toolCall('delegate', {});
    expect(a).toMatchObject({ type: 'function', function: { name: 'report_user_mood', arguments: '{"mood":"calm","intensity":0.2}' } });
    expect(a.id).toMatch(/^call_\d+$/);
    expect(a.id).not.toBe(b.id);
    expect(completed('hi').thread_id).toBe('thread-1');
    expect(requiresAction([a]).thread_id).toBe('thread-1');
    expect(completed('hi').retrieved_memories).toBeUndefined();
  });
});

describe('FakeSpecialists', () => {
  const ctx = (signal: AbortSignal = new AbortController().signal): SpecialistRunContext => ({ jobId: 'j1', taskId: 't1', kind: 'normal', signal });

  it('waits delayMs on the FakeClock (not done at 2999 ms, done at 3000 ms)', async () => {
    const clock = new FakeClock(0);
    const sp = new FakeSpecialists({ clock });
    let result: AgentResult | undefined;
    void sp.run('eagle', 'find flights', ctx()).then((r) => (result = r));
    await clock.advanceAsync(2999);
    expect(result).toBeUndefined();
    await clock.advanceAsync(1);
    expect(result).toMatchObject({
      ok: true,
      say: 'Found three good options!',
      bubble: 'Scout ✓',
      summary: 'Scout finished: find flights',
      artifacts: [],
    });
    expect(sp.runs).toHaveLength(1);
    expect(sp.runs[0]).toMatchObject({ agentId: 'eagle', task: 'find flights', startedAt: 0 });
  });

  it('trims the task to 80 chars in the default summary', async () => {
    const clock = new FakeClock(0);
    const sp = new FakeSpecialists({ clock, delayMs: 0 });
    const p = sp.run('beaver', 'x'.repeat(200), ctx());
    await clock.advanceAsync(0);
    expect((await p).summary).toBe(`Archie finished: ${'x'.repeat(80)}`);
  });

  it('supports per-agent delays with a 3000 ms fallback', async () => {
    const clock = new FakeClock(0);
    const sp = new FakeSpecialists({ clock, delayMs: { beaver: 500 } });
    const done: string[] = [];
    void sp.run('beaver', 'a', ctx()).then(() => done.push('beaver'));
    void sp.run('eagle', 'b', ctx()).then(() => done.push('eagle'));
    await clock.advanceAsync(500);
    expect(done).toEqual(['beaver']);
    await clock.advanceAsync(2500);
    expect(done).toEqual(['beaver', 'eagle']);
  });

  it('rejects with AbortError and clears its timer when the signal aborts', async () => {
    const clock = new FakeClock(0);
    const sp = new FakeSpecialists({ clock });
    const ac = new AbortController();
    const p = sp.run('eagle', 'x', ctx(ac.signal));
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.pending()).toBe(1);
    ac.abort();
    await assertion;
    expect(clock.pending()).toBe(0);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const clock = new FakeClock(0);
    const sp = new FakeSpecialists({ clock });
    const ac = new AbortController();
    ac.abort();
    await expect(sp.run('eagle', 'x', ctx(ac.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.pending()).toBe(0);
  });

  it('uses custom behaviors (constructor and setBehavior)', async () => {
    const clock = new FakeClock(0);
    const sp = new FakeSpecialists({
      clock,
      delayMs: 10,
      behaviors: { workspace: (task) => fakeResult('workspace', { ok: false, summary: `failed: ${task}` }) },
    });
    const a = sp.run('workspace', 'draft', ctx());
    await clock.advanceAsync(10);
    expect(await a).toMatchObject({ ok: false, summary: 'failed: draft' });

    sp.setBehavior('ants', async (_task, c) => fakeResult('ants', { say: `job ${c.jobId}` }));
    const b = sp.run('ants', 'plan', ctx());
    await clock.advanceAsync(10);
    expect((await b).say).toBe('job j1');
  });

  it('fakeResult applies overrides', () => {
    expect(fakeResult('butterfly', { bubble: 'Hi', artifacts: [{ kind: 'social_post', title: 'Post' }] })).toMatchObject({
      ok: true,
      bubble: 'Hi',
      artifacts: [{ kind: 'social_post', title: 'Post' }],
    });
    expect(fakeResult('nightingale').bubble).toBe('Celene ✓');
  });
});

describe('StubWardenGate', () => {
  it('denies external with rule W1 and emits wolf.verdict', () => {
    const bus = new EventBus({ clock: new FakeClock(0) });
    const gate = new StubWardenGate(bus);
    const verdict = gate.review({ agentId: 'workspace', taskId: 't1', callId: 'c1', tool: 'gmail_send', risk: 'external' });
    expect(verdict).toBe('deny');
    expect(bus.recent()).toHaveLength(1);
    expect(bus.recent()[0]).toMatchObject({ type: 'wolf.verdict', agentId: 'wolf', taskId: 't1', callId: 'c1', verdict: 'deny', rule: 'W1' });
  });

  it.each(['read', 'draft', 'write', 'destructive'] as const)('reviews %s with the stub rule', (risk) => {
    const bus = new EventBus({ clock: new FakeClock(0) });
    const gate = new StubWardenGate(bus);
    const ask = risk === 'write' || risk === 'destructive';
    expect(gate.review({ agentId: 'beaver', taskId: 't1', callId: 'c2', tool: 'fs_list', risk })).toBe(ask ? 'ask' : 'allow');
    expect(bus.recent()[0]).toMatchObject({ type: 'wolf.verdict', agentId: 'wolf', verdict: ask ? 'ask' : 'allow', rule: ask ? 'W3' : 'W2' });
  });
});

describe('FakeCalendar', () => {
  it('builds three default events relative to construction time', async () => {
    const clock = new FakeClock(new Date(2026, 9, 4, 12, 0));
    const cal = new FakeCalendar(clock);
    const now = clock.now();
    expect(cal.events.map((e) => e.id)).toEqual(['ev-midterm', 'ev-standup', 'ev-interview']);
    const midterm = cal.events[0]!;
    expect(midterm.title).toBe('CS 280 Midterm');
    expect(midterm.start.getTime()).toBe(now - 85 * MIN);
    expect(midterm.end.getTime()).toBe(now + 5 * MIN);
    clock.advance(10 * MIN); // events were fixed at construction
    expect(midterm.end.getTime()).toBe(now + 5 * MIN);
    expect(cal.events[1]!.end.getTime() - cal.events[1]!.start.getTime()).toBe(15 * MIN);
    expect(cal.events[2]!.end.getTime() - cal.events[2]!.start.getTime()).toBe(60 * MIN);
  });

  it('lists only overlapping events, sorted by start', async () => {
    const clock = new FakeClock(new Date(2026, 9, 4, 12, 0));
    const cal = new FakeCalendar(clock);
    const now = clock.now();
    const day = 24 * 60 * MIN;
    expect((await cal.listEvents(new Date(now), new Date(now + 2 * MIN))).map((e) => e.id)).toEqual(['ev-midterm']);
    expect(await cal.listEvents(new Date(now + 5 * MIN), new Date(now + day - MIN))).toEqual([]);
    expect((await cal.listEvents(new Date(now - day), new Date(now + 4 * day))).map((e) => e.id)).toEqual(['ev-midterm', 'ev-standup', 'ev-interview']);
    expect((await cal.listEvents(new Date(now + day + 10 * MIN), new Date(now + day + 20 * MIN))).map((e) => e.id)).toEqual(['ev-standup']);
  });

  it('sorts custom events by start', async () => {
    const clock = new FakeClock(0);
    const b = { id: 'b', title: 'B', start: new Date(2000), end: new Date(3000) };
    const a = { id: 'a', title: 'A', start: new Date(1000), end: new Date(2500) };
    const cal = new FakeCalendar(clock, [b, a]);
    expect((await cal.listEvents(new Date(0), new Date(5000))).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('testing index', () => {
  it('re-exports settings helpers', () => {
    expect(makeTestSettings().timers.sleepAfterSec).toBe(180);
  });
});
