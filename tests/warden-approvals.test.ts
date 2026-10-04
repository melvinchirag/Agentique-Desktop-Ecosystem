import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import { createApprovals, APPROVAL_TIMEOUT_MS } from '../src/main/wolf/approvals';
import { FakeClock, flushPromises } from '../src/main/runtime/clock';
import { createJobScheduler } from '../src/main/runtime/jobs';
import type { ApprovalRequest, Job, JobScheduler, PresenceManager, SpecialistRunner } from '../src/main/runtime/types';
import type { AgentId } from '../src/shared/agents';
import { makeTestSettings } from '../src/main/testing/settings';

function fixture(jobsList: Job[] = []) {
  const clock = new FakeClock(0);
  const bus = new EventBus({ clock, sessionId: 'test' });
  const jobs = {
    list: vi.fn(() => jobsList),
    pauseClock: vi.fn(),
    resumeClock: vi.fn(),
  };
  const onDeclined = vi.fn();
  const approvals = createApprovals({ bus, clock, jobs, onDeclined });
  const controller = new AbortController();
  const request = (callId: string, jobId = 'job-1', agentId: AgentId = 'beaver', signal = controller.signal): ApprovalRequest => ({
    callId, jobId, taskId: 'task-1', agentId, title: `${callId} needs OK`, preview: 'Move one fixture file', signal,
  });
  return { clock, bus, jobs, approvals, onDeclined, controller, request };
}

function job(jobId: string, agent: Job['agent'], kind: Job['kind'], requestedBy: AgentId, taskId = 'task-1'): Job {
  return { jobId, agent, kind, requestedBy, parentTaskId: taskId, state: 'running', task: 'Fixture task', title: 'Fixture task' };
}

describe('Warden approvals', () => {
  it('W-18: times out after five visible minutes, declines, and resumes the job', async () => {
    const f = fixture();
    const pending = f.approvals.request(f.request('one'));
    expect(f.bus.recent().map((e) => e.type)).toEqual(['approval.request', 'agent.status']);
    expect(f.approvals.pending()[0].expiresAt).toBe(APPROVAL_TIMEOUT_MS);
    f.clock.advance(APPROVAL_TIMEOUT_MS - 1);
    expect(f.approvals.pending()).toHaveLength(1);
    f.clock.advance(1);
    expect(await pending).toEqual({ approved: false, how: 'timeout' });
    expect(f.jobs.resumeClock).toHaveBeenCalledExactlyOnceWith('job-1');
    expect(f.onDeclined).toHaveBeenCalledOnce();
    expect(f.bus.recent().map((e) => e.type)).toEqual(['approval.request', 'agent.status', 'approval.resolve', 'agent.status']);
  });

  it('W-19: abort cancels the visible card and clears its timer', async () => {
    const f = fixture();
    const pending = f.approvals.request(f.request('one'));
    f.controller.abort();
    expect(await pending).toEqual({ approved: false, how: 'cancelled' });
    expect(f.approvals.pending()).toEqual([]);
    expect(f.clock.pending()).toBe(0);
    expect(f.jobs.resumeClock).toHaveBeenCalledExactlyOnceWith('job-1');
  });

  it('W-29: keeps one job paused through two asks and starts the second timer when shown', async () => {
    const f = fixture();
    const first = f.approvals.request(f.request('one'));
    const second = f.approvals.request(f.request('two'));
    expect(f.jobs.pauseClock).toHaveBeenCalledExactlyOnceWith('job-1');
    expect(f.bus.recent().filter((e) => e.type === 'approval.request').map((e) => e.callId)).toEqual(['one']);
    expect(f.approvals.pending().map((p) => p.expiresAt)).toEqual([APPROVAL_TIMEOUT_MS, Infinity]);
    f.clock.advance(60_000);
    f.approvals.resolve('one', true);
    expect(await first).toEqual({ approved: true, how: 'user' });
    expect(f.jobs.resumeClock).not.toHaveBeenCalled();
    expect(f.approvals.pending()[0].expiresAt).toBe(60_000 + APPROVAL_TIMEOUT_MS);
    f.approvals.resolve('two', false);
    expect(await second).toEqual({ approved: false, how: 'user' });
    expect(f.jobs.resumeClock).toHaveBeenCalledExactlyOnceWith('job-1');
    expect(f.onDeclined).toHaveBeenCalledOnce();
  });

  it('W-30: a help ask pauses its own clock and the matching asking job', async () => {
    const parent = job('parent', 'workspace', 'normal', 'chipmunk');
    const help = job('help', 'beaver', 'help', 'workspace');
    const unrelated = job('other', 'workspace', 'normal', 'chipmunk', 'another-task');
    const f = fixture([unrelated, help, parent]);
    const pending = f.approvals.request(f.request('one', 'help'));
    expect(f.jobs.pauseClock.mock.calls.map(([id]) => id)).toEqual(['help', 'parent']);
    f.approvals.resolve('one', true);
    expect(await pending).toEqual({ approved: true, how: 'user' });
    expect(f.jobs.resumeClock.mock.calls.map(([id]) => id)).toEqual(['help', 'parent']);
  });

  it('W15: shows at most one card per job and three globally, in eligible FIFO order', async () => {
    const f = fixture();
    const requests = [
      f.approvals.request(f.request('a', 'job-1')),
      f.approvals.request(f.request('b', 'job-1')),
      f.approvals.request(f.request('c', 'job-2')),
      f.approvals.request(f.request('d', 'job-2')),
    ];
    const shown = () => f.bus.recent().filter((e) => e.type === 'approval.request').map((e) => e.callId);
    expect(shown()).toEqual(['a', 'c']);
    f.approvals.resolve('a', true);
    expect(shown()).toEqual(['a', 'c', 'b']);
    f.approvals.resolve('c', true);
    expect(shown()).toEqual(['a', 'c', 'b', 'd']);
    f.approvals.resolve('b', true);
    f.approvals.resolve('d', true);
    expect(await Promise.all(requests)).toEqual(Array(4).fill({ approved: true, how: 'user' }));
  });

  it('W15: caps visible cards at three across independent jobs', async () => {
    const f = fixture();
    const requests = ['a', 'b', 'c', 'd'].map((id) => f.approvals.request(f.request(id, `job-${id}`)));
    const shown = () => f.bus.recent().filter((e) => e.type === 'approval.request').map((e) => e.callId);
    expect(shown()).toEqual(['a', 'b', 'c']);
    expect(f.approvals.pending().find((p) => p.callId === 'd')?.expiresAt).toBe(Infinity);
    f.clock.advance(30_000);
    f.approvals.resolve('b', true);
    expect(shown()).toEqual(['a', 'b', 'c', 'd']);
    expect(f.approvals.pending().find((p) => p.callId === 'd')?.expiresAt).toBe(30_000 + APPROVAL_TIMEOUT_MS);
    for (const id of ['a', 'c', 'd']) f.approvals.resolve(id, true);
    expect((await Promise.all(requests)).every((r) => r.approved)).toBe(true);
  });

  it('does not emit a stale waiting status when a subscriber cancels a new card', async () => {
    const f = fixture();
    f.bus.subscribe((event) => {
      if (event.type === 'approval.request') f.controller.abort();
    });
    const outcome = await f.approvals.request(f.request('one'));
    expect(outcome).toEqual({ approved: false, how: 'cancelled' });
    expect(f.bus.recent().map((e) => e.type)).toEqual(['approval.request', 'approval.resolve']);
    expect(f.clock.pending()).toBe(0);
  });

  it('handles a synchronous approval response without a stale waiting status or timer', async () => {
    const f = fixture();
    f.bus.subscribe((event) => {
      if (event.type === 'approval.request') f.approvals.resolve(event.callId, true);
    });
    expect(await f.approvals.request(f.request('one'))).toEqual({ approved: true, how: 'user' });
    expect(f.bus.recent().map((e) => e.type)).toEqual(['approval.request', 'approval.resolve']);
    expect(f.jobs.resumeClock).toHaveBeenCalledExactlyOnceWith('job-1');
    expect(f.clock.pending()).toBe(0);
  });

  it('settles a decline even if the gate callback throws', async () => {
    const f = fixture();
    f.onDeclined.mockImplementation(() => { throw new Error('gate failed'); });
    const pending = f.approvals.request(f.request('one'));
    f.approvals.resolve('one', false);
    expect(await pending).toEqual({ approved: false, how: 'user' });
    expect(f.approvals.pending()).toEqual([]);
    expect(f.jobs.resumeClock).toHaveBeenCalledExactlyOnceWith('job-1');
    expect(f.clock.pending()).toBe(0);
  });

  it('stop never shows or approves an aborted queued card during refill', async () => {
    const f = fixture();
    const first = f.approvals.request(f.request('one'));
    const second = f.approvals.request(f.request('two'));
    f.bus.subscribe((event) => {
      if (event.type === 'approval.request') f.approvals.resolve(event.callId, true);
    });
    f.controller.abort();
    expect(await Promise.all([first, second])).toEqual(Array(2).fill({ approved: false, how: 'cancelled' }));
    expect(f.bus.recent().filter((event) => event.type === 'approval.request').map((event) => event.callId)).toEqual(['one']);
    expect(f.clock.pending()).toBe(0);
    expect(f.jobs.resumeClock).toHaveBeenCalledExactlyOnceWith('job-1');
  });

  it('ignores unknown, settled, and queued call IDs', async () => {
    const f = fixture();
    const first = f.approvals.request(f.request('one'));
    const second = f.approvals.request(f.request('two'));
    f.approvals.resolve('missing', true);
    f.approvals.resolve('two', true);
    expect(f.approvals.pending()).toHaveLength(2);
    f.approvals.resolve('one', true);
    expect(await first).toEqual({ approved: true, how: 'user' });
    f.approvals.resolve('one', false);
    f.approvals.resolve('two', true);
    expect(await second).toEqual({ approved: true, how: 'user' });
  });

  it('cancelForJobs and dispose decline visible and queued requests without refilling', async () => {
    const f = fixture();
    const a = f.approvals.request(f.request('a', 'job-1'));
    const b = f.approvals.request(f.request('b', 'job-1'));
    const c = f.approvals.request(f.request('c', 'job-2'));
    f.approvals.cancelForJobs(['job-1']);
    expect(await Promise.all([a, b])).toEqual(Array(2).fill({ approved: false, how: 'cancelled' }));
    f.approvals.dispose();
    expect(await c).toEqual({ approved: false, how: 'cancelled' });
    expect(f.approvals.pending()).toEqual([]);
    expect(f.clock.pending()).toBe(0);
    expect(f.onDeclined).toHaveBeenCalledTimes(3);
    expect(await f.approvals.request(f.request('late'))).toEqual({ approved: false, how: 'cancelled' });
  });

  it('W-20: real scheduler keeps a job alive through a four-minute approval', async () => {
    const clock = new FakeClock(0);
    const bus = new EventBus({ clock, sessionId: 'test' });
    let approvals: ReturnType<typeof createApprovals>;
    let entered!: () => void;
    const requested = new Promise<void>((resolve) => { entered = resolve; });
    const runner: SpecialistRunner = {
      async run(_agent, _task, context) {
        const approval = approvals.request({ callId: 'real', jobId: context.jobId, taskId: context.taskId,
          agentId: 'beaver', title: 'Fixture approval', preview: 'Move one fixture file', signal: context.signal });
        entered();
        const outcome = await approval;
        return { ok: outcome.approved, say: 'Done', bubble: 'Done', summary: 'Fixture done', artifacts: [] };
      },
    };
    const presence: PresenceManager = {
      start() {}, get() { return 'active'; }, touch() {}, setBusy() {},
      async wake() {}, onChange() {}, dispose() {},
    };
    const jobs = createJobScheduler({ bus, clock, runner, presence,
      settings: () => makeTestSettings(), newId: () => 'real-job' });
    approvals = createApprovals({ bus, clock, jobs });
    const started = jobs.submit({ agent: 'beaver', task: 'Fixture', title: 'Fixture',
      kind: 'normal', requestedBy: 'chipmunk', parentTaskId: 'task-1' });
    await requested;
    await clock.advanceAsync(4 * 60_000);
    expect(jobs.list().find((j) => j.jobId === started.jobId)?.state).toBe('running');
    approvals.resolve('real', true);
    await flushPromises();
    expect((await jobs.waitFor(started.jobId!)).ok).toBe(true);
  });
});
