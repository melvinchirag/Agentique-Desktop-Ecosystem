import { afterEach, describe, expect, it } from 'vitest';
import type { BiomeEvent } from '../src/shared/events';
import type { AdeSettings } from '../src/shared/ipc';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock, flushPromises } from '../src/main/runtime/clock';
import { MemoryHistoryStore } from '../src/main/runtime/history';
import { createJobScheduler } from '../src/main/runtime/jobs';
import { createMoodEngine } from '../src/main/runtime/mood';
import { MemoryNudgeStore } from '../src/main/runtime/nudgeStore';
import { ANSWER_WINDOW_MS, createNudgeEngine } from '../src/main/runtime/nudges';
import {
  createOrchestrator, FOGGY_LINE, MAX_TOOL_ROUNDS, PARTWAY_LINE, RESULT_BATCH_MS, TOOL_OUTPUT_MAX_CHARS,
} from '../src/main/runtime/orchestrator';
import { createPresenceManager } from '../src/main/runtime/presence';
import type { LlmResponse, SendParams, SpecialistId } from '../src/main/runtime/types';
import {
  completed, FakeCalendar, FakeLlm, type FakeLlmCall, type FakeLlmStep, FakeSpecialists, fakeResult, requiresAction, toolCall,
} from '../src/main/testing';
import { makeTestSettings } from '../src/main/testing/settings';

const SEC = 1000;
const MIN = 60 * SEC;

type Ev<T extends BiomeEvent['type']> = Extract<BiomeEvent, { type: T }>;

interface SetupOpts {
  script?: FakeLlmStep[];
  delayMs?: number | Partial<Record<SpecialistId, number>>;
  settings?: Partial<AdeSettings>;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function setup(o: SetupOpts = {}) {
  const clock = new FakeClock(new Date(2026, 9, 4, 12, 0));
  const bus = new EventBus({ clock, sessionId: 's' });
  const settings = () => makeTestSettings(o.settings);
  const presence = createPresenceManager({ bus, clock, settings });
  const specialists = new FakeSpecialists({ clock, delayMs: o.delayMs ?? 3 * SEC });
  let jobN = 0;
  const jobs = createJobScheduler({ bus, clock, runner: specialists, presence, settings, newId: () => `job${++jobN}` });
  const moodEngine = createMoodEngine({ bus, clock, settings, presence });
  const store = new MemoryNudgeStore();
  let nudgeN = 0;
  // Not started: no planner / rule nudges, so the only nudges are the ones a test schedules.
  const nudges = createNudgeEngine({
    bus, clock, settings, store, calendar: new FakeCalendar(clock), llm: new FakeLlm(), chipAssistantId: 'chip-asst',
    isUserBusy: () => false, newId: () => `n${++nudgeN}`,
  });
  const history = new MemoryHistoryStore({ bus, clock });
  const llm = new FakeLlm(o.script ?? []);
  let taskN = 0;
  const orch = createOrchestrator(
    { bus, clock, llm, jobs, presence, mood: moodEngine, nudges, history, settings, chipAssistantId: 'chip-asst', timeZone: 'America/Detroit' },
    { newId: () => `task${++taskN}` },
  );
  presence.start();
  cleanups.push(() => {
    orch.dispose();
    nudges.dispose();
    moodEngine.dispose();
    presence.dispose();
  });

  const events = (): BiomeEvent[] => bus.recent();
  const ofType = <T extends BiomeEvent['type']>(t: T): Ev<T>[] => events().filter((e): e is Ev<T> => e.type === t);
  const chipSays = (priority?: Ev<'agent.say'>['priority']) =>
    ofType('agent.say').filter((e) => e.agentId === 'chipmunk' && (!priority || e.priority === priority));
  const sends = (): SendParams[] => llm.calls.flatMap((c) => (c.kind === 'send' ? [c.params] : []));
  const toolOutputs = () => llm.calls.flatMap((c) => (c.kind === 'toolOutputs' ? [c] : []));
  const user = async (text: string, opts?: { source?: 'text' | 'voice'; voiceCues?: string[] }): Promise<void> => {
    orch.submitUserMessage(text, opts);
    await orch.whenIdle();
  };
  /** Advance the fake clock, then wait for any turn that started to finish. */
  const advance = async (ms: number): Promise<void> => {
    await clock.advanceAsync(ms);
    await orch.whenIdle();
  };
  const fireNudge = async (about: string, question: string): Promise<string> => {
    const id = nudges.schedule({ kind: 'custom', source: 'chip', about, question, askAt: new Date(clock.now() + MIN) });
    nudges.fireNextNow();
    await flushPromises();
    await orch.whenIdle();
    return id;
  };

  return {
    clock, bus, presence, specialists, jobs, mood: moodEngine, store, nudges, llm, orch,
    events, ofType, chipSays, sends, toolOutputs, user, advance, fireNudge,
  };
}

const mood = (m = 'calm', intensity = 0.4, reason = 'plain words') => toolCall('report_user_mood', { mood: m, intensity, reason });
const delegate = (agent: SpecialistId, title: string, extra: Record<string, unknown> = {}) =>
  toolCall('delegate', { agent, task: `Please do: ${title}`, title, ...extra });
const outputOf = (call: FakeLlmCall | undefined, i = 0): Record<string, unknown> => {
  if (!call || call.kind !== 'toolOutputs') throw new Error('not a toolOutputs call');
  return JSON.parse(call.outputs[i]!.output) as Record<string, unknown>;
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('orchestrator', () => {
  it('C1 small talk: mood, then bubble + speech, events in §8 order, no jobs', async () => {
    const t = setup({ script: [requiresAction([mood('happy', 0.6, 'greeting')]), completed('[bubble: Hi!]\nHey there!')] });
    await t.user('hi chip!');

    expect(t.jobs.list()).toHaveLength(0);
    expect(t.specialists.runs).toHaveLength(0);

    const seq = t.events()
      .filter((e) => e.type === 'user.message' || e.type === 'user.mood'
        || ((e.type === 'agent.status' || e.type === 'agent.say') && e.agentId === 'chipmunk'))
      .map((e) => (e.type === 'agent.status' ? `status:${e.status}` : e.type === 'agent.say' ? `say:${e.priority}` : e.type));
    expect(seq).toEqual(['user.message', 'status:listening', 'status:thinking', 'user.mood', 'say:chip', 'status:idle']);

    const all = t.events();
    const moodIdx = all.findIndex((e) => e.type === 'agent.mood' && e.agentId === 'chipmunk');
    expect(moodIdx).toBeGreaterThan(all.findIndex((e) => e.type === 'user.mood'));
    expect(moodIdx).toBeLessThan(all.findIndex((e) => e.type === 'agent.say'));

    expect(t.chipSays()[0]).toMatchObject({ text: 'Hey there!', bubble: 'Hi!', priority: 'chip', taskId: 'task1' });
    expect(t.ofType('user.message')[0]).toMatchObject({ agentId: 'chipmunk', text: 'hi chip!', source: 'text', taskId: 'task1' });
    expect(t.ofType('user.mood')[0]).toMatchObject({ agentId: 'chipmunk', mood: 'happy', intensity: 0.6, taskId: 'task1' });
    expect(t.mood.getUserMood()).toBe('happy');

    const p = t.sends()[0]!;
    expect(p).toMatchObject({ assistantId: 'chip-asst', memory: 'Auto', timeoutMs: 25_000, model: makeTestSettings().models.chipmunk });
    expect(p.threadId).toBeUndefined();
    expect(p.systemPrompt).toContain('You are Chip');
    expect(p.content.startsWith('[context]')).toBe(true);
    expect(p.content).toContain('[user]\nhi chip!');
    expect(p.tools?.map((x) => x.function.name)).toEqual(['report_user_mood', 'delegate', 'cancel_jobs', 'schedule_followup', 'biome_history']);
    expect(outputOf(t.toolOutputs()[0])).toEqual({ ok: true });
  });

  it('C2 email: ack, (silent), then one Readonly result turn 1.5 s after the job → Chip summary', async () => {
    const t = setup({
      script: [
        requiresAction([mood('calm'), delegate('workspace', "Today's inbox")]),
        completed('(silent)'),
        completed('[bubble: 5 emails]\nFive emails today. Prof Lee moved the quiz to Monday.'),
      ],
    });
    t.specialists.setBehavior('workspace', () => fakeResult('workspace', { summary: 'Five emails; Prof Lee moved the quiz to Monday.' }));
    await t.user('what emails did I get today?');

    expect(t.chipSays('ack')).toEqual([expect.objectContaining({ text: "Ooh, mail duty! Pixel, you're up!", bubble: 'Pixel 📬' })]);
    expect(t.chipSays('chip')).toHaveLength(0);
    expect(outputOf(t.toolOutputs()[0], 1)).toEqual({ status: 'started', jobId: 'job1' });
    expect(t.jobs.list()[0]).toMatchObject({ agent: 'workspace', requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'task1' });

    await t.advance(3 * SEC);                                      // Pixel finishes
    await t.advance(RESULT_BATCH_MS - 1);
    expect(t.sends()).toHaveLength(1);
    await t.advance(1);
    expect(t.sends()).toHaveLength(2);

    const r = t.sends()[1]!;
    expect(r.memory).toBe('Readonly');
    expect(r.content.startsWith('[job_results]')).toBe(true);
    expect(r.content).toContain('summary: Five emails; Prof Lee moved the quiz to Monday.');
    expect(r.content).toContain('original request: "what emails did I get today?"');

    const summary = t.chipSays('chip')[0]!;
    expect(summary).toMatchObject({ text: 'Five emails today. Prof Lee moved the quiz to Monday.', bubble: '5 emails', taskId: 'task1' });
    const all = t.events();
    const report = all.findIndex((e) => e.type === 'agent.say' && e.agentId === 'workspace' && e.priority === 'report');
    expect(report).toBeGreaterThan(-1);
    expect(report).toBeLessThan(all.indexOf(summary));

    // The result turn: thinking only (no listening), every event on the original taskId.
    const resultStatuses = t.ofType('agent.status').filter((e) => e.agentId === 'chipmunk').slice(-2);
    expect(resultStatuses.map((e) => [e.status, e.taskId])).toEqual([['thinking', 'task1'], ['idle', 'task1']]);
  });

  it('recovers a silent mood-only turn once and actually delegates the pending request', async () => {
    const t = setup({ script: [requiresAction([mood()]), completed('(silent)'),
      requiresAction([delegate('eagle', 'Pizza near campus')]), completed('(silent)')] });
    await t.user('find pizza near campus');
    expect(t.sends()).toHaveLength(2);
    expect(t.sends()[1]!.memory).toBe('Readonly');
    expect(t.sends()[1]!.tools?.map((tool) => tool.function.name)).not.toContain('report_user_mood');
    expect(t.sends()[1]!.threadId).toBeTruthy();
    expect(t.sends()[1]!.content).toContain('[runtime_feedback]');
    expect(t.sends()[1]!.content).toContain('find pizza near campus');
    expect(t.jobs.list()).toHaveLength(1);
    expect(t.jobs.list()[0]).toMatchObject({ agent: 'eagle', parentTaskId: 'task1', state: 'running' });
    expect(t.chipSays('ack')).toHaveLength(1);
    expect(t.chipSays('chip')).toHaveLength(0);
  });

  it.each(['(silent)', ''])('bounds recovery for an unanswered %j response and explains failure', async (answer) => {
    const t = setup({ script: [completed(answer), completed(answer)] });
    await t.user('check my email');
    expect(t.sends()).toHaveLength(2);
    expect(t.jobs.list()).toHaveLength(0);
    expect(t.chipSays('chip').at(-1)?.text).toBe("I couldn't finish that request. Please try again.");
  });

  it('does not retry an action that has already been attempted', async () => {
    const t = setup({ script: [requiresAction([toolCall('unknown_tool', {})]), completed('(silent)')] });
    await t.user('cancel the pending work please');
    expect(t.sends()).toHaveLength(1);
    expect(t.toolOutputs()).toHaveLength(1);
    expect(t.chipSays('chip').at(-1)?.text).toBe("I couldn't finish that request. Please try again.");
  });

  it('answers instead of ending silently after a successful read-only history call', async () => {
    const t = setup({ script: [requiresAction([toolCall('biome_history', { kind: 'recent_tasks' })]), completed('(silent)')] });
    await t.user('What have you done for me today?');
    expect(t.sends()).toHaveLength(1);
    expect(t.chipSays('chip').at(-1)?.text).toBe("I couldn't finish that request. Please try again.");
  });

  it('C6 chain: next_step reaches the result turn, then Chip delegates to Pixel with the result in the task', async () => {
    const t = setup({
      script: [
        requiresAction([mood('excited', 0.6), delegate('eagle', 'Internship research', { next_step: 'draft email to Melvin with the list' })]),
        completed('(silent)'),
        (call) => {
          const content = call.kind === 'send' ? call.params.content : '';
          expect(content).toContain('next_step: draft email to Melvin with the list');
          const found = /summary: (.*)/.exec(content)?.[1] ?? '';
          return requiresAction([toolCall('delegate', { agent: 'workspace', title: 'Email to Melvin', task: `Draft an email to Melvin listing: ${found}` })]);
        },
        completed("[bubble: Drafting]\nScout found three. Pixel's drafting the email to Melvin now."),
      ],
    });
    t.specialists.setBehavior('eagle', () => fakeResult('eagle', { summary: 'Acme (remote), Globex (NYC), Initech (Detroit).' }));
    await t.user('research internships, then draft an email to Melvin');
    expect(t.jobs.list()[0]).toMatchObject({ agent: 'eagle', nextStep: 'draft email to Melvin with the list' });

    await t.advance(3 * SEC + RESULT_BATCH_MS);
    const pixelRun = t.specialists.runs.find((r) => r.agentId === 'workspace');
    expect(pixelRun?.task).toContain('Acme (remote), Globex (NYC), Initech (Detroit).');
    expect(pixelRun?.ctx.taskId).toBe('task1');
    expect(t.chipSays('ack')).toHaveLength(1);                    // the result turn's delegate gets no ack
    expect(t.chipSays('chip').at(-1)?.text).toBe("Scout found three. Pixel's drafting the email to Melvin now.");
  });

  it('C16 unclear: one short question is spoken; no jobs', async () => {
    const t = setup({ script: [requiresAction([mood('calm', 0.3)]), completed('[bubble: Which one?]\nSend what, and to whom?')] });
    await t.user('send that to them');
    expect(t.chipSays()).toEqual([expect.objectContaining({ text: 'Send what, and to whom?', bubble: 'Which one?', priority: 'chip' })]);
    expect(t.jobs.list()).toHaveLength(0);
  });

  it('C17 Backboard down: sad + error + foggy line; the next message works', async () => {
    const t = setup({
      script: [new Error('network down'), requiresAction([mood('happy', 0.5)]), completed('[bubble: Back!]\nOkay, I hear you now.')],
    });
    await t.user('hello?');

    const first = t.events().filter((e) => e.taskId === 'task1');
    const tail = first.filter((e) => e.agentId === 'chipmunk' && ['agent.mood', 'agent.status', 'agent.say'].includes(e.type)).slice(-4);
    expect(tail.map((e) => e.type)).toEqual(['agent.mood', 'agent.status', 'agent.say', 'agent.status']);
    expect(tail[0]).toMatchObject({ mood: 'sad', intensity: 0.6, cause: 'user' });
    expect(tail[1]).toMatchObject({ status: 'error' });
    expect(tail[2]).toMatchObject({ text: FOGGY_LINE, bubble: 'Foggy 😵', priority: 'chip' });
    expect(tail[3]).toMatchObject({ status: 'idle' });
    expect(first.some((e) => e.type === 'user.mood')).toBe(false);  // no mood fallback on a failed turn

    await t.user('hello again');
    expect(t.chipSays().at(-1)).toMatchObject({ text: 'Okay, I hear you now.', taskId: 'task2' });
  });

  it('the foggy sad mood resets to neutral after moodDecaySec (20 s)', async () => {
    const t = setup({ script: [new Error('network down')] });
    await t.user('hello?');
    const chipMoods = () => t.ofType('agent.mood').filter((e) => e.agentId === 'chipmunk').map((e) => e.mood);
    expect(chipMoods()).toEqual(['sad']);
    await t.advance(20 * SEC - 1);
    expect(chipMoods()).toEqual(['sad']);
    await t.advance(1);
    expect(chipMoods()).toEqual(['sad', 'neutral']);
  });

  it('the foggy reset never overrides a newer mood', async () => {
    const t = setup({ script: [new Error('network down'), requiresAction([mood('angry', 0.9, 'all caps')]), completed('[bubble: Sorry]\nI hear you.')] });
    await t.user('hello?');
    await t.advance(5 * SEC);
    await t.user('WHY IS NOTHING WORKING');                              // Chip → scared via the MoodEngine
    await t.advance(16 * SEC);                                             // past the foggy timer (20 s after the failure)
    const chipMoods = t.ofType('agent.mood').filter((e) => e.agentId === 'chipmunk').map((e) => e.mood);
    expect(chipMoods).toEqual(['sad', 'scared']);                          // no stray 'neutral' from the foggy timer
  });

  it('review fix: inherited names like "constructor" are unknown tools', async () => {
    const t = setup({ script: [requiresAction([toolCall('constructor', {}), toolCall('toString', {})]), completed('[bubble: Hm]\nHm.')] });
    await t.user('hi');
    const out = t.toolOutputs()[0]!;
    expect(outputOf(out, 0)).toEqual({ error: 'unknown tool: constructor' });
    expect(outputOf(out, 1)).toEqual({ error: 'unknown tool: toString' });
  });

  it('review fix: submitToolOutputs always gets a deadline signal', async () => {
    let seen: AbortSignal | undefined;
    const t = setup({ script: [requiresAction([mood()]), completed('[bubble: Hi]\nHi!')] });
    const real = t.llm.submitToolOutputs.bind(t.llm);
    t.llm.submitToolOutputs = (id, outputs, signal) => {
      seen = signal;
      return real(id, outputs, signal);
    };
    await t.user('hi');
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);
  });

  it('review fix: a malformed report_user_mood outside a user turn is ignored with ok', async () => {
    const t = setup({ script: [completed('[bubble: Hi]\nHi!')] });
    await t.user('hi');
    t.llm.push(requiresAction([toolCall('report_user_mood', { mood: 'furious' })]), completed('[bubble: Back]\nBack!'));
    await t.fireNudge('CS 280 midterm', 'How did it go?');
    expect(outputOf(t.toolOutputs()[0])).toEqual({ ok: true });
  });

  it('review fix: a failure in the stop / nudge-answer path still ends with the foggy line and idle', async () => {
    const t = setup({ script: [completed('[bubble: Hi]\nAsk away!')] });
    await t.fireNudge('CS 280 midterm', 'How did it go?');
    t.nudges.markAnswered = () => { throw new Error('store down'); };
    const origError = console.error;
    console.error = () => {};
    try {
      await t.user('it went great');
    } finally {
      console.error = origError;
    }
    const last = t.events().filter((e) => e.taskId === 'task2' && e.agentId === 'chipmunk').map((e) => e.type).slice(-2);
    expect(last).toEqual(['agent.say', 'agent.status']);
    expect(t.chipSays().at(-1)).toMatchObject({ text: FOGGY_LINE });
    expect(t.ofType('agent.status').at(-1)).toMatchObject({ status: 'idle', taskId: 'task2' });
  });

  it('a stop command wakes a sleeping Chip before it speaks', async () => {
    const t = setup({ delayMs: 10 * MIN });
    await t.advance(180 * SEC);                                            // sleepAfterSec → Chip asleep
    expect(t.presence.get('chipmunk')).toBe('sleeping');
    await t.user('stop');
    const order = t.events()
      .filter((e) => (e.type === 'agent.presence' && e.agentId === 'chipmunk' && e.presence === 'active')
        || (e.type === 'agent.say' && e.agentId === 'chipmunk'))
      .map((e) => e.type);
    expect(order.slice(-2)).toEqual(['agent.presence', 'agent.say']);
    expect(t.presence.get('chipmunk')).toBe('active');
  });

  it('a non-LLM failure inside a turn logs and speaks the foggy line; the loop continues', async () => {
    const t = setup({ script: [completed('[bubble: Hi]\nHi!')] });
    const realList = t.jobs.list.bind(t.jobs);
    let calls = 0;
    t.jobs.list = () => {
      if (++calls === 1) throw new Error('boom');
      return realList();
    };
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => { errors.push(a); };
    try {
      await t.user('first');
    } finally {
      console.error = origError;
    }
    expect(errors).toHaveLength(1);
    expect(t.chipSays().at(-1)).toMatchObject({ text: FOGGY_LINE, taskId: 'task1' });
    expect(t.ofType('agent.status').some((e) => e.status === 'error')).toBe(false);

    await t.user('second');
    expect(t.chipSays().at(-1)).toMatchObject({ text: 'Hi!', taskId: 'task2' });
  });

  it('stop: "stop Scout" cancels only Scout with no LLM call; "stop" cancels everything', async () => {
    const t = setup({ delayMs: 60 * SEC });
    const req = (agent: SpecialistId, title: string) =>
      t.jobs.submit({ agent, task: title, title, requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'old' });
    req('eagle', 'Pizza near campus');
    req('workspace', 'Check inbox');
    await t.clock.advanceAsync(0);

    await t.user('stop Scout');
    expect(t.llm.calls).toHaveLength(0);
    const cancelled = () => t.ofType('job.update').filter((e) => e.state === 'cancelled').map((e) => e.to);
    expect(cancelled()).toEqual(['eagle']);
    expect(t.chipSays()).toEqual([expect.objectContaining({ text: 'Stopped Scout!', bubble: 'Stopped', priority: 'chip', taskId: 'task1' })]);
    expect(t.ofType('agent.status').filter((e) => e.taskId === 'task1').map((e) => e.status)).toEqual(['idle']);

    await t.user('Stop.');
    expect(t.llm.calls).toHaveLength(0);
    expect(cancelled()).toEqual(['eagle', 'workspace']);
    expect(t.chipSays().at(-1)).toMatchObject({ text: 'Stopping!', bubble: 'Stopping' });
  });

  it('stop check: more than 4 words is a normal turn; "never mind" and "nvm" count', async () => {
    const t = setup({ script: [completed('[bubble: Sure]\nSure thing.')] });
    await t.user('stop by the store later today');
    expect(t.sends()).toHaveLength(1);

    await t.user('never mind');
    await t.user('nvm pixel');
    expect(t.sends()).toHaveLength(1);
    expect(t.chipSays().slice(-2).map((e) => e.text)).toEqual(['Stopping!', 'Stopped Pixel!']);
  });

  it('batching: two jobs of one task finishing 1 s apart → one result turn with both', async () => {
    const t = setup({
      delayMs: { eagle: 3 * SEC, workspace: 4 * SEC },
      script: [
        requiresAction([mood(), delegate('eagle', 'Pizza near campus'), delegate('workspace', 'Check inbox')]),
        completed('(silent)'),
        completed('[bubble: Both back]\nPizza found and inbox checked.'),
      ],
    });
    await t.user('find pizza and check my email');
    await t.advance(4 * SEC + RESULT_BATCH_MS - 1);
    expect(t.sends()).toHaveLength(1);
    await t.advance(1);
    expect(t.sends()).toHaveLength(2);
    const c = t.sends()[1]!.content;
    expect(c).toContain('Scout [eagle] · "Pizza near campus" · ok');
    expect(c).toContain('Pixel [workspace] · "Check inbox" · ok');
  });

  it('batching: 2 s apart → two result turns', async () => {
    const t = setup({
      delayMs: { eagle: 3 * SEC, workspace: 5 * SEC },
      script: [
        requiresAction([mood(), delegate('eagle', 'Pizza near campus'), delegate('workspace', 'Check inbox')]),
        completed('(silent)'),
        completed("[bubble: Pizza]\nTony's is closest."),
        completed('[bubble: Inbox]\nNothing urgent in your inbox.'),
      ],
    });
    await t.user('find pizza and check my email');
    await t.advance(10 * SEC);
    const results = t.sends().slice(1);
    expect(results).toHaveLength(2);
    expect(results[0]!.content).toContain('Scout [eagle]');
    expect(results[0]!.content).not.toContain('Pixel [workspace] ·');
    expect(results[1]!.content).toContain('Pixel [workspace] · "Check inbox"');
  });

  it('inbox order: a user message that arrives during a result turn runs before a queued nudge', async () => {
    const gate = deferred<LlmResponse>();
    const t = setup({
      script: [
        requiresAction([mood(), delegate('eagle', 'Pizza near campus')]),
        completed('(silent)'),
        () => gate.promise,                                         // result turn, held open
        completed('[bubble: Hi]\nHi again!'),
        completed('[bubble: Hey]\nHow did the midterm go?'),
      ],
    });
    await t.user('find pizza');
    await t.clock.advanceAsync(3 * SEC + RESULT_BATCH_MS);
    expect(t.sends()).toHaveLength(2);                              // result turn waiting on Backboard

    t.nudges.schedule({ kind: 'custom', source: 'chip', about: 'midterm', question: 'How did the midterm go?', askAt: new Date(t.clock.now() + MIN) });
    t.nudges.fireNextNow();
    await flushPromises();
    t.orch.submitUserMessage('hi again');
    gate.resolve(completed("[bubble: Pizza]\nTony's is closest."));
    await t.orch.whenIdle();

    const kinds = t.sends().map((s) => (s.content.startsWith('[job_results]') ? 'result' : s.content.startsWith('[nudge]') ? 'nudge' : 'user'));
    expect(kinds).toEqual(['user', 'result', 'user', 'nudge']);
    expect(t.sends()[2]!.content).toContain('[user]\nhi again');
  });

  it('mood fallback: no report_user_mood + (sighs) → stressed 0.5; (laughter) → happy 0.5; else calm 0.3', async () => {
    const t = setup({
      script: [completed('[bubble: Okay]\nOkay, I hear you.'), completed('[bubble: Ha]\nHa!'), completed('[bubble: Sure]\nSure.')],
    });
    await t.user('ugh, fine', { source: 'voice', voiceCues: ['(sighs)'] });
    expect(t.sends()[0]!.content).toContain('voice_cues: (sighs)');
    expect(t.ofType('user.message')[0]).toMatchObject({ source: 'voice' });
    await t.user('that was funny', { source: 'voice', voiceCues: ['laughter'] });
    await t.user('ok');

    expect(t.ofType('user.mood').map((e) => [e.mood, e.intensity, e.taskId])).toEqual([
      ['stressed', 0.5, 'task1'], ['happy', 0.5, 'task2'], ['calm', 0.3, 'task3'],
    ]);
    expect(t.ofType('agent.mood').find((e) => e.agentId === 'chipmunk')).toMatchObject({ mood: 'nervous', taskId: 'task1' });
  });

  it('tool loop: a round runs all calls and submits every output in one call', async () => {
    const t = setup({
      script: [
        requiresAction([toolCall('report_user_mood', { mood: 'calm', intensity: 3, reason: 'x' }, 'c1'), toolCall('biome_history', { kind: 'mood_history' }, 'c2')], 'thread-9'),
        completed('[bubble: Calm]\nYou have been calm.', 'thread-9'),
      ],
    });
    await t.user('how have I been feeling?');
    const outs = t.toolOutputs();
    expect(outs).toHaveLength(1);
    expect(outs[0]!.threadId).toBe('thread-9');
    expect(outs[0]!.outputs.map((o) => o.tool_call_id)).toEqual(['c1', 'c2']);
    expect(outputOf(outs[0], 0)).toEqual({ ok: true });
    expect(outputOf(outs[0], 1)).toHaveProperty('rows');
    expect(t.ofType('user.mood')[0]).toMatchObject({ intensity: 1 });           // clamped
  });

  it('tool loop: unknown tool, bad JSON, bad args → error outputs; outputs are capped', async () => {
    const t = setup({
      script: [
        requiresAction([
          toolCall('fly_to_the_moon', {}),
          { id: 'bad', type: 'function', function: { name: 'delegate', arguments: '{not json' } },
          toolCall('report_user_mood', { mood: 'grumpy', intensity: 0.5, reason: 'x' }),
          toolCall('delegate', { agent: 'butterfly', task: 'Post', title: 'Post' }),            // not installed
          toolCall('delegate', { agent: 'eagle', task: '  ', title: 'Pizza' }),
          toolCall('delegate', { agent: 'x'.repeat(20_000), task: 'a', title: 'b' }),
          toolCall('biome_history', { kind: 'secrets' }),
          toolCall('cancel_jobs', { agent: 'wolf' }),
        ]),
        completed('[bubble: Hmm]\nThat did not work.'),
      ],
    });
    await t.user('do stuff');
    const call = t.toolOutputs()[0]!;
    const errors = call.outputs.map((o) => (o.output.startsWith('{"error":') ? (JSON.parse(o.output.length < TOOL_OUTPUT_MAX_CHARS ? o.output : '{"error":"long"}') as { error: string }).error : 'not an error'));
    expect(errors[0]).toMatch(/unknown tool/);
    expect(errors[1]).toMatch(/bad JSON/);
    expect(errors[2]).toBe('bad mood');
    expect(errors[3]).toMatch(/not installed/);
    expect(errors[4]).toMatch(/task/);
    expect(errors[5]).toBe('long');
    expect(call.outputs[5]!.output).toHaveLength(TOOL_OUTPUT_MAX_CHARS);
    expect(errors[6]).toBe('bad kind');
    expect(errors[7]).toMatch(/unknown agent/);
    expect(t.jobs.list()).toHaveLength(0);
    expect(t.chipSays('ack')).toHaveLength(0);
  });

  it(`tool loop: still REQUIRES_ACTION after ${MAX_TOOL_ROUNDS} rounds → PARTWAY_LINE`, async () => {
    const round = () => requiresAction([toolCall('biome_history', { kind: 'recent_tasks' })]);
    const t = setup({ script: Array.from({ length: MAX_TOOL_ROUNDS + 1 }, round) });
    await t.user('what did you do today?');
    expect(t.toolOutputs()).toHaveLength(MAX_TOOL_ROUNDS);
    expect(t.llm.remaining()).toBe(0);
    expect(t.chipSays().at(-1)).toMatchObject({ text: PARTWAY_LINE, priority: 'chip' });
  });

  it('recall: retrieved_memories → one agent.recall per distinct set in a turn', async () => {
    const memories = ['CS 280 midterm is Monday'];
    const t = setup({
      script: [
        { ...requiresAction([mood()]), retrieved_memories: memories },
        completed("[bubble: Midterm]\nYour CS 280 midterm is Monday. You've got this!", 'thread-1', memories),
      ],
    });
    await t.user('what do I have coming up?');
    expect(t.ofType('agent.recall').map((e) => [e.agentId, e.memories, e.taskId])).toEqual([['chipmunk', memories, 'task1']]);
  });

  it('acks: one per user turn, "On it." when the user is stressed, none in result turns', async () => {
    const t = setup({
      script: [
        requiresAction([mood('stressed', 0.7, 'deadline'), delegate('eagle', 'Pizza near campus'), delegate('beaver', 'Find syllabus')]),
        completed('(silent)'),
        requiresAction([delegate('workspace', 'Email the list')]),     // one result turn for Scout + Archie
        completed('[bubble: Pixel]\nPixel is emailing the list.'),
      ],
    });
    await t.user('quick, find pizza and my syllabus');
    expect(t.chipSays('ack')).toEqual([expect.objectContaining({ text: 'On it.', bubble: 'On it' })]);

    await t.advance(3 * SEC + RESULT_BATCH_MS);
    expect(t.specialists.runs.map((r) => r.agentId)).toContain('workspace');
    expect(t.chipSays('ack')).toHaveLength(1);
  });

  it('acks: queued and duplicate statuses', async () => {
    const t = setup({
      delayMs: 60 * SEC,
      script: [
        requiresAction([mood(), delegate('eagle', 'Pizza near campus')]), completed('(silent)'),
        requiresAction([mood(), delegate('eagle', 'Laptop deals')]), completed('(silent)'),
        requiresAction([mood(), delegate('eagle', 'pizza near campus!')]), completed('(silent)'),
      ],
    });
    await t.user('find pizza');
    await t.user('find laptop deals');
    await t.user('find pizza near campus');
    expect(t.chipSays('ack').map((e) => e.text)).toEqual(['Scout, fly! We need intel!', "Scout's busy. You're next in line!", "Scout's already on it!"]);
    expect(outputOf(t.toolOutputs()[1], 1)).toEqual({ status: 'queued', jobId: 'job2', position: 1 });
  });

  it('nudge turn: wakes Chip, content [nudge] with Readonly memory; "later" → snooze 120 min', async () => {
    const t = setup({
      script: [completed('[bubble: Hey!]\nHow did the CS 280 midterm go?'), completed("[bubble: Sure]\nI'll ask again later.")],
    });
    await t.advance(180 * SEC);                                     // Chip dozes off
    expect(t.presence.get('chipmunk')).toBe('sleeping');

    const id = await t.fireNudge('CS 280 midterm', 'How did the CS 280 midterm go?');
    const n = t.sends()[0]!;
    expect(n.content.startsWith('[nudge]')).toBe(true);
    expect(n.content).toContain('suggested question: How did the CS 280 midterm go?');
    expect(n.memory).toBe('Readonly');

    const all = t.events();
    const fire = all.findIndex((e) => e.type === 'nudge.fire');
    const wake = all.findIndex((e) => e.type === 'agent.presence' && e.agentId === 'chipmunk' && e.presence === 'active' && e.reason === 'job');
    const turn = all.filter((e) => e.agentId === 'chipmunk' && (e.type === 'agent.status' || e.type === 'agent.say') && e.taskId === 'task1');
    expect(fire).toBeLessThan(wake);
    expect(wake).toBeLessThan(all.indexOf(turn[0]!));
    expect(turn.map((e) => (e.type === 'agent.status' ? e.status : 'say'))).toEqual(['thinking', 'say', 'idle']);
    expect(t.ofType('user.mood')).toHaveLength(0);                 // no mood fallback outside user turns

    await t.user('later');
    await flushPromises();
    const stored = t.store.all.find((x) => x.id === id)!;
    expect(stored.state).toBe('snoozed');
    expect(stored.askAt.getTime()).toBe(t.clock.now() + 120 * MIN);
    expect(t.sends()).toHaveLength(2);                              // the reply is still a normal turn
  });

  it('nudge answers: "stop asking about that" cancels (not a job stop); other replies mark answered once', async () => {
    const t = setup({
      delayMs: 60 * SEC,
      script: [
        completed('[bubble: Hey]\nHow did it go?'), completed('[bubble: Okay]\nGot it.'),
        completed('[bubble: Hey]\nHow was the game?'), completed('[bubble: Nice]\nNice!'), completed('[bubble: Cool]\nCool.'),
      ],
    });
    t.jobs.submit({ agent: 'eagle', task: 'x', title: 'Research', requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'old' });

    const a = await t.fireNudge('interview', 'How did it go?');
    await t.user('stop asking about that');
    await flushPromises();
    expect(t.store.all.find((x) => x.id === a)!.state).toBe('cancelled');
    expect(t.jobs.list().find((j) => j.agent === 'eagle')!.state).toBe('running');

    const b = await t.fireNudge('game', 'How was the game?');
    await t.user('we won!');
    await t.user('anyway');
    await flushPromises();
    expect(t.store.all.find((x) => x.id === b)!.state).toBe('answered');
  });

  it('nudge answers: a reply after the 10 min window does not touch the nudge', async () => {
    const t = setup({ script: [completed('[bubble: Hey]\nHow did it go?'), completed('[bubble: Ok]\nOk.')] });
    const id = await t.fireNudge('interview', 'How did it go?');
    await t.advance(ANSWER_WINDOW_MS);
    await t.user('later');
    await flushPromises();
    expect(t.store.all.find((x) => x.id === id)!.state).toBe('fired');
  });

  it('thread reuse: the second Chip turn sends the thread_id from the first response', async () => {
    const t = setup({ script: [completed('[bubble: Hi]\nHi!', 'thread-abc'), completed('[bubble: Yo]\nYo!', 'thread-abc')] });
    await t.user('hi');
    await t.user('hi again');
    expect(t.sends().map((s) => s.threadId)).toEqual([undefined, 'thread-abc']);
  });

  it('a help job finishing does not start a result turn', async () => {
    const t = setup();
    t.jobs.submit({ agent: 'beaver', task: 'Find the syllabus', title: 'Find syllabus', requestedBy: 'workspace', kind: 'help', parentTaskId: 't-help' });
    await t.advance(3 * SEC + RESULT_BATCH_MS * 2);
    expect(t.ofType('job.update').some((e) => e.to === 'beaver' && e.state === 'done')).toBe(true);
    expect(t.llm.calls).toHaveLength(0);
  });

  it('schedule_followup and cancel_jobs executors', async () => {
    const t = setup({
      delayMs: 60 * SEC,
      script: [
        requiresAction([
          toolCall('schedule_followup', { question: 'How did the interview go?', about: 'Google interview', ask_at: '2026-10-08T18:00:00-04:00' }),
          toolCall('schedule_followup', { question: 'q', about: 'past', ask_at: '2020-01-01T00:00:00Z' }),
          toolCall('schedule_followup', { question: 'q', about: 'bad', ask_at: 'next tuesday' }),
        ]),
        requiresAction([toolCall('cancel_jobs', { agent: 'eagle' }), toolCall('cancel_jobs', {})]),
        completed('[bubble: Noted]\nGood luck at the interview!'),
      ],
    });
    t.jobs.submit({ agent: 'eagle', task: 'x', title: 'One', requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'old' });
    t.jobs.submit({ agent: 'workspace', task: 'x', title: 'Two', requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'old' });
    await t.user('I have my Google interview Thursday at 5');
    await flushPromises();

    const [first, second] = t.toolOutputs();
    expect(outputOf(first, 0)).toEqual({ id: 'n1' });
    expect(outputOf(first, 1)).toEqual({ error: 'bad ask_at' });
    expect(outputOf(first, 2)).toEqual({ error: 'bad ask_at' });
    expect(t.store.all[0]).toMatchObject({ kind: 'custom', source: 'chip', about: 'Google interview', state: 'pending' });
    expect(t.store.all[0]!.askAt.toISOString()).toBe('2026-10-08T22:00:00.000Z');
    expect(outputOf(second, 0)).toEqual({ cancelled: 1 });
    expect(outputOf(second, 1)).toEqual({ cancelled: 1 });
  });

  it('dispose: stops accepting input and ignores finished jobs', async () => {
    const t = setup({ script: [requiresAction([mood(), delegate('eagle', 'Pizza')]), completed('(silent)')] });
    await t.user('find pizza');
    t.orch.dispose();
    t.orch.submitUserMessage('hello?');
    await t.advance(10 * SEC);
    await t.orch.whenIdle();
    expect(t.sends()).toHaveLength(1);
  });
});
