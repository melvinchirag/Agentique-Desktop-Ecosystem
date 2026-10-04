import { describe, expect, it, vi } from 'vitest';
import type { AgentDefinition, ToolDefinition } from '../src/shared/tools';
import { EventBus } from '../src/main/bus/eventBus';
import { AgentRuntime, SPECIALIST_TOOL_OUTPUT_MAX_CHARS } from '../src/main/runtime/agentRuntime';
import { FakeClock } from '../src/main/runtime/clock';
import { parseSpecialistOutput } from '../src/main/runtime/specialistOutput';
import type { AgentResult, ApprovalOutcome, Approvals, JobScheduler, WardenGate } from '../src/main/runtime/types';
import { FakeLlm, completed, requiresAction, toolCall } from '../src/main/testing/fakeLlm';
import { makeTestSettings } from '../src/main/testing/settings';

const done = 'BUBBLE: All set\nSAY: I found it.\nSUMMARY: Work complete.';
const context = () => ({ jobId: 'job-1', taskId: 'task-1', kind: 'normal' as const, signal: new AbortController().signal });
const result: AgentResult = { ok: true, say: 'Found it.', bubble: 'Found', summary: 'The file is here.', artifacts: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(script: ConstructorParameters<typeof FakeLlm>[0], tools: ToolDefinition[] = []) {
  const llm = new FakeLlm(script);
  const bus = new EventBus({ clock: new FakeClock(), sessionId: 'session-1' });
  const gate: WardenGate = { review: vi.fn(() => 'allow' as const) };
  const jobs: JobScheduler = {
    submit: vi.fn(() => ({ status: 'started' as const, jobId: 'help-1' })), waitFor: vi.fn(async () => result),
    cancel: vi.fn(() => 0), list: vi.fn(() => []), onFinished: vi.fn(), pauseClock: vi.fn(), resumeClock: vi.fn(),
  };
  const approvals: Approvals = {
    request: vi.fn(async (): Promise<ApprovalOutcome> => ({ approved: true, how: 'user' })),
    resolve: vi.fn(), cancelForJobs: vi.fn(), pending: vi.fn(() => []), dispose: vi.fn(),
  };
  const beaver: AgentDefinition = { id: 'beaver', systemPrompt: 'Be Archie.', tools, maxToolRounds: 8 };
  const eagle: AgentDefinition = { id: 'eagle', systemPrompt: 'Be Scout.', tools: [], maxToolRounds: 8, webSearch: true };
  const runtime = new AgentRuntime({ bus, llm, jobs, gate, approvals, settings: () => makeTestSettings(), agents: [
    { definition: beaver, assistantId: 'beaver-assistant' }, { definition: eagle, assistantId: 'eagle-assistant' },
  ] });
  return { runtime, llm, bus, gate, jobs, approvals };
}

const readTool = (name: string, execute: ToolDefinition['execute']): ToolDefinition => ({
  name, description: name, parameters: { type: 'object' }, risk: 'read', execute,
});
const outputsOf = (llm: FakeLlm) => llm.calls.filter((call) => call.kind === 'toolOutputs');

describe('AgentRuntime', () => {
  it('creates fresh threads with model and memory chosen per job kind', async () => {
    const s = setup([completed(done, 't1'), completed(done, 't2')]);
    expect((await s.runtime.run('beaver', 'sort', context())).summary).toBe('Work complete.');
    expect((await s.runtime.run('beaver', 'find', { ...context(), kind: 'help' })).ok).toBe(true);
    const sends = s.llm.calls.filter((call) => call.kind === 'send');
    expect(sends).toHaveLength(2);
    expect(sends.map((call) => call.params.threadId)).toEqual([undefined, undefined]);
    expect(sends.map((call) => call.params.memory)).toEqual(['Auto', 'Readonly']);
    expect(sends[0]!.params).toMatchObject({ assistantId: 'beaver-assistant', content: 'sort', systemPrompt: 'Be Archie.', model: makeTestSettings().models.beaver });
    expect(sends[0]!.params.tools?.some((tool) => tool.function.name === 'ask_teammate')).toBe(true);
    expect(sends[1]!.params.tools?.some((tool) => tool.function.name === 'ask_teammate')).toBe(false);
  });

  it('executes a whole tool round concurrently and submits every output together', async () => {
    const a = deferred<{ value: string }>();
    const b = deferred<{ value: string }>();
    const started: string[] = [];
    const s = setup([requiresAction([toolCall('first', {}, 'c1'), toolCall('second', {}, 'c2')], 'fresh'), completed(done, 'fresh')], [
      readTool('first', async () => { started.push('first'); return a.promise; }),
      readTool('second', async () => { started.push('second'); return b.promise; }),
    ]);
    const pending = s.runtime.run('beaver', 'work', context());
    await vi.waitFor(() => expect(started).toEqual(['first', 'second']));
    expect(outputsOf(s.llm)).toHaveLength(0);
    b.resolve({ value: 'b' }); a.resolve({ value: 'a' });
    expect((await pending).ok).toBe(true);
    expect(outputsOf(s.llm)[0]).toMatchObject({ threadId: 'fresh', outputs: [
      { tool_call_id: 'c1', output: '{"value":"a"}' }, { tool_call_id: 'c2', output: '{"value":"b"}' },
    ] });
    expect(s.gate.review).toHaveBeenCalledTimes(2);
  });

  it('returns Warden denial and user decline without executing tools', async () => {
    const execute = vi.fn(async () => ({ done: true }));
    const tool = { ...readTool('change', execute), risk: 'write' as const, preview: () => 'Rename one file' };
    const s = setup([requiresAction([toolCall('change', {}, 'denied'), toolCall('change', {}, 'declined')]), completed(done)], [tool]);
    vi.mocked(s.gate.review).mockReturnValueOnce('deny').mockReturnValueOnce('ask');
    s.gate.explain = () => ({ rule: 'W3', reason: 'Needs approval' });
    vi.mocked(s.approvals.request).mockResolvedValue({ approved: false, how: 'user' });
    await s.runtime.run('beaver', 'change', context());
    const outputs = outputsOf(s.llm)[0]!.outputs.map((item) => JSON.parse(item.output));
    expect(outputs).toEqual([{ error: 'DENIED_BY_WOLF', rule: 'W3', reason: 'Needs approval' }, { error: 'USER_DECLINED' }]);
    expect(execute).not.toHaveBeenCalled();
    expect(s.bus.recent().filter((event) => event.type === 'tool.result').map((event) => event.ok)).toEqual([false, false]);
  });

  it('lets Approvals pause and resume the clock exactly once', async () => {
    const tool = { ...readTool('move', async () => ({ moved: true })), risk: 'write' as const, preview: () => 'Move file' };
    const s = setup([requiresAction([toolCall('move', {}, 'c1')]), completed(done)], [tool]);
    vi.mocked(s.gate.review).mockReturnValue('ask');
    const decision = deferred<ApprovalOutcome>();
    vi.mocked(s.approvals.request).mockImplementation(async (request) => {
      s.jobs.pauseClock(request.jobId); // the fake Approvals service owns the pause
      try { return await decision.promise; }
      finally { s.jobs.resumeClock(request.jobId); }
    });
    const pending = s.runtime.run('beaver', 'move', context());
    await vi.waitFor(() => expect(s.jobs.pauseClock).toHaveBeenCalledTimes(1));
    expect(s.jobs.resumeClock).not.toHaveBeenCalled();
    decision.resolve({ approved: true, how: 'user' });
    expect((await pending).ok).toBe(true);
    expect(s.jobs.pauseClock).toHaveBeenCalledTimes(1);
    expect(s.jobs.resumeClock).toHaveBeenCalledTimes(1);
    expect(s.approvals.request).toHaveBeenCalledWith(expect.objectContaining({ callId: 'c1', jobId: 'job-1', preview: 'Move file' }));
  });

  it('submits teammate help and does not expose help recursion', async () => {
    const s = setup([requiresAction([toolCall('ask_teammate', { agent: 'eagle', request: 'Find sources' })]), completed(done),
      requiresAction([toolCall('ask_teammate', { agent: 'eagle', request: 'Again' })], 'help-thread'), completed(done, 'help-thread')]);
    await s.runtime.run('beaver', 'Ask Scout', context());
    expect(s.jobs.submit).toHaveBeenCalledWith(expect.objectContaining({ agent: 'eagle', kind: 'help', requestedBy: 'beaver', parentTaskId: 'task-1' }));
    expect(s.jobs.waitFor).toHaveBeenCalledWith('help-1');
    expect(JSON.parse(outputsOf(s.llm)[0]!.outputs[0]!.output)).toEqual({ ok: true, summary: 'The file is here.' });
    await s.runtime.run('beaver', 'Help', { ...context(), kind: 'help' });
    expect(JSON.parse(outputsOf(s.llm)[1]!.outputs[0]!.output)).toEqual({ error: 'UNKNOWN_TOOL' });
    expect(s.jobs.submit).toHaveBeenCalledTimes(1);
    expect(s.gate.review).not.toHaveBeenCalled();
  });

  it('collects emitted artifacts and provides the fresh thread ID to the tool', async () => {
    const s = setup([requiresAction([toolCall('draft', {}, 'c1')], 'job-thread'), completed(done, 'job-thread')], [
      readTool('draft', async (_args, ctx) => {
        expect(ctx.threadId).toBe('job-thread');
        expect(ctx.sessionId).toBe('session-1');
        ctx.emit({ type: 'artifact', agentId: 'beaver', taskId: ctx.taskId, kind: 'file_note', title: 'Notes', data: { text: 'fixture' } });
        return { saved: true };
      }),
    ]);
    expect((await s.runtime.run('beaver', 'draft', context())).artifacts).toEqual([{ kind: 'file_note', title: 'Notes' }]);
    expect(s.bus.recent().some((event) => event.type === 'artifact')).toBe(true);
  });

  it('caps large tool outputs as valid JSON and retries one Backboard failure', async () => {
    const s = setup([new Error('temporary'), requiresAction([toolCall('large', {}, 'c1')]), completed(done)], [
      readTool('large', async () => ({ text: 'x'.repeat(20_000) })),
    ]);
    expect((await s.runtime.run('beaver', 'read', context())).ok).toBe(true);
    expect(s.llm.calls.filter((call) => call.kind === 'send')).toHaveLength(2);
    const data = outputsOf(s.llm)[0]!.outputs[0]!.output;
    expect(data.length).toBeLessThanOrEqual(SPECIALIST_TOOL_OUTPUT_MAX_CHARS);
    expect(JSON.parse(data)).toMatchObject({ truncated: true });
  });

  it('screens the final say and summary: clean results pass wrapped, flagged ones are replaced', async () => {
    const make = (flag: boolean) => {
      const screen = vi.fn(async (text: string, _source: unknown) => ({ flagged: flag && text.startsWith('Work'), score: flag ? 0.9 : 0, reasons: [], wrapped: `<untrusted>${text}</untrusted>` }));
      const runtime = new AgentRuntime({
        bus: new EventBus({ clock: new FakeClock(), sessionId: 's' }), llm: new FakeLlm([completed(done, 't')]),
        jobs: setup([]).jobs, gate: { review: () => 'allow' }, approvals: setup([]).approvals,
        settings: () => makeTestSettings(), screen: { screen },
        agents: [{ definition: { id: 'beaver', systemPrompt: 'x', tools: [], maxToolRounds: 8 }, assistantId: 'a' }],
      });
      return { runtime, screen };
    };

    const clean = make(false);
    const ok = await clean.runtime.run('beaver', 'sort', context());
    expect(ok).toMatchObject({ ok: true, say: 'I found it.', bubble: 'All set', summary: '<untrusted>Work complete.</untrusted>' });
    expect(clean.screen).toHaveBeenCalledWith('Work complete.', { kind: 'summary', name: 'Archie', taskId: 'task-1', jobId: 'job-1' });

    const flagged = await make(true).runtime.run('beaver', 'sort', context());
    expect(flagged).toMatchObject({ ok: true, say: 'Done, but Warden flagged something in it.', bubble: 'Review needed' });
    expect(flagged.summary).toBe('<untrusted>Work complete.</untrusted>');
  });

  it('returns a failed result after the retry is exhausted', async () => {
    const s = setup([new Error('offline'), new Error('offline')]);
    expect(await s.runtime.run('beaver', 'read', context())).toMatchObject({ ok: false, say: 'Hit a snag.', summary: 'offline' });
  });
});

describe('specialist output parser', () => {
  it('keeps a multiline summary', () => {
    expect(parseSpecialistOutput('BUBBLE: Sorted\nSAY: Done.\nSUMMARY: First line\nSecond line', 'Archie'))
      .toEqual({ bubble: 'Sorted', say: 'Done.', summary: 'First line\nSecond line' });
  });

  it('uses the first sentence, up to twelve words, and the agent name on malformed output', () => {
    expect(parseSpecialistOutput('One two three. More detail follows.', 'Archie'))
      .toEqual({ bubble: 'Archie', say: 'One two three.', summary: 'One two three. More detail follows.' });
    expect(parseSpecialistOutput('BUBBLE: Missing other fields', 'Archie').bubble).toBe('Archie');
  });
});
