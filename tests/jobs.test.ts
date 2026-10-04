import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, Presence } from '../src/shared/agents';
import type { BiomeEvent } from '../src/shared/events';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock, flushPromises } from '../src/main/runtime/clock';
import {
  createJobScheduler, HELP_JOB_TIMEOUT_MS, NORMAL_JOB_TIMEOUT_MS, normalizeTitle,
} from '../src/main/runtime/jobs';
import type {
  AgentResult, JobRequest, JobScheduler, PresenceManager, SpecialistId, SpecialistRunContext, SpecialistRunner,
} from '../src/main/runtime/types';
import { makeTestSettings } from '../src/main/testing/settings';

// ── Fakes ─────────────────────────────────────────────────

interface RunCall {
  agent: SpecialistId; task: string; ctx: SpecialistRunContext;
  resolve: (r: AgentResult) => void; reject: (e: unknown) => void;
}

class FakeRunner implements SpecialistRunner {
  calls: RunCall[] = [];
  constructor(private log: string[]) {}
  run(agent: SpecialistId, task: string, ctx: SpecialistRunContext): Promise<AgentResult> {
    this.log.push(`run:${agent}`);
    return new Promise<AgentResult>((resolve, reject) => this.calls.push({ agent, task, ctx, resolve, reject }));
  }
}

class FakePresence implements PresenceManager {
  presence = new Map<AgentId, Presence>();
  constructor(private log: string[]) {}
  start(): void {}
  get(id: AgentId): Presence {
    return this.presence.get(id) ?? 'active';
  }
  touch(id: AgentId): void {
    this.log.push(`touch:${id}`);
  }
  setBusy(id: AgentId, busy: boolean): void {
    this.log.push(`busy:${id}:${busy}`);
  }
  async wake(id: AgentId, reason: 'user' | 'job'): Promise<void> {
    this.log.push(`wake:${id}:${reason}`);
    await Promise.resolve();
    this.presence.set(id, 'active');
  }
  onChange(): void {}
  dispose(): void {}
}

/** setBusy(true) calls minus setBusy(false) calls for an animal, from the fake presence log. */
const busyNet = (id: AgentId): number =>
  log.filter((l) => l === `busy:${id}:true`).length - log.filter((l) => l === `busy:${id}:false`).length;

const ok = (summary = 'All good.'): AgentResult => ({ ok: true, say: 'Found it!', bubble: 'Done', summary, artifacts: [] });

function req(agent: SpecialistId, title: string, extra: Partial<JobRequest> = {}): JobRequest {
  return { agent, task: `Do: ${title}`, title, requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'task-1', ...extra };
}

// ── Setup ─────────────────────────────────────────────────

let clock: FakeClock;
let bus: EventBus;
let events: BiomeEvent[];
let log: string[];
let runner: FakeRunner;
let presence: FakePresence;
let jobs: JobScheduler;

beforeEach(() => {
  clock = new FakeClock(0);
  bus = new EventBus({ clock, sessionId: 's' });
  events = [];
  bus.subscribe((e) => events.push(e));
  log = [];
  runner = new FakeRunner(log);
  presence = new FakePresence(log);
  let n = 0;
  jobs = createJobScheduler({ bus, clock, runner, presence, settings: () => makeTestSettings(), newId: () => `job-${++n}` });
});

const ofType = <T extends BiomeEvent['type']>(t: T) =>
  events.filter((e): e is Extract<BiomeEvent, { type: T }> => e.type === t);
const jobUpdates = () => ofType('job.update').map((e) => `${e.jobId}:${e.state}${e.position !== undefined ? `@${e.position}` : ''}`);

// ── Tests ─────────────────────────────────────────────────

describe('normalizeTitle', () => {
  it('lowercases, trims, strips punctuation, collapses spaces', () => {
    expect(normalizeTitle('  Pizza,  near CAMPUS!! ')).toBe('pizza near campus');
    expect(normalizeTitle("Mom's   e-mail?")).toBe('moms email');
  });
});

describe('JobScheduler', () => {
  it('C3 parallel: different animals run at once', async () => {
    const a = jobs.submit(req('eagle', 'Pizza near campus'));
    const b = jobs.submit(req('workspace', 'Check email'));
    expect(a.status).toBe('started');
    expect(b.status).toBe('started');
    await flushPromises();
    expect(runner.calls.map((c) => c.agent)).toEqual(['eagle', 'workspace']);
    expect(jobs.list().filter((j) => j.state === 'running')).toHaveLength(2);
  });

  it('C4 queue: same animal waits in line, positions shift, runs after the first', async () => {
    const a = jobs.submit(req('eagle', 'First'));
    const b = jobs.submit(req('eagle', 'Second'));
    const c = jobs.submit(req('eagle', 'Third'));
    expect(b).toEqual({ status: 'queued', jobId: 'job-2', position: 1 });
    expect(c).toEqual({ status: 'queued', jobId: 'job-3', position: 2 });
    await flushPromises();
    expect(runner.calls).toHaveLength(1);
    expect(ofType('agent.handoff')).toHaveLength(1);                 // no handoff for queued jobs

    runner.calls[0].resolve(ok());
    await flushPromises();
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[1].ctx.jobId).toBe(b.jobId);
    expect(jobUpdates()).toEqual([
      'job-1:running', 'job-2:queued@1', 'job-3:queued@2',
      'job-1:done', 'job-3:queued@1', 'job-2:running',
    ]);
    expect(a.jobId).toBe('job-1');
  });

  it('C5 duplicate: same title with different case/punctuation, running or queued', async () => {
    const a = jobs.submit(req('eagle', 'Pizza near campus'));
    const b = jobs.submit(req('eagle', 'Weather today'));
    await flushPromises();
    const before = events.length;
    expect(jobs.submit(req('eagle', '  PIZZA near, campus!! '))).toEqual({ status: 'duplicate', jobId: a.jobId });
    expect(jobs.submit(req('eagle', 'weather   TODAY.'))).toEqual({ status: 'duplicate', jobId: b.jobId });
    expect(events.length).toBe(before);
    // Same title for a different animal is not a duplicate.
    expect(jobs.submit(req('workspace', 'Pizza near campus')).status).toBe('started');
  });

  it('C7 help bypass: help job starts while the helper is busy; waitFor gets the result', async () => {
    jobs.submit(req('beaver', 'Organize downloads'));
    const help = jobs.submit(req('beaver', 'Find syllabus', { kind: 'help', requestedBy: 'workspace' }));
    expect(help.status).toBe('started');
    await flushPromises();
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[1].ctx.kind).toBe('help');
    expect(runner.calls[0].ctx.kind).toBe('normal');

    const running = ofType('job.update').filter((e) => e.jobId === help.jobId);
    expect(running[0]).toMatchObject({ state: 'running', agentId: 'workspace', requestedBy: 'workspace', to: 'beaver' });
    expect(ofType('agent.handoff')[1]).toMatchObject({ agentId: 'workspace', to: 'beaver', task: 'Find syllabus' });

    const result = ok('Syllabus.pdf in Documents/EMU.');
    runner.calls[1].resolve(result);
    await expect(jobs.waitFor(help.jobId!)).resolves.toEqual(result);
    expect(ofType('agent.return')[0]).toMatchObject({ agentId: 'beaver', to: 'workspace', ok: true });
    // Archie's own job is still running, so he stays busy: two holds taken, one released.
    expect(busyNet('beaver')).toBe(1);
    expect(jobs.list().find((j) => j.jobId === 'job-1')?.state).toBe('running');

    // When his own job ends, the holds balance out (PresenceManager counts them).
    runner.calls[0].resolve(ok());
    await flushPromises();
    expect(busyNet('beaver')).toBe(0);
  });

  it('setBusy holds always balance, including cancelled overlapping jobs', async () => {
    jobs.submit(req('beaver', 'Organize downloads'));
    jobs.submit(req('beaver', 'Find syllabus', { kind: 'help', requestedBy: 'workspace' }));
    jobs.submit(req('beaver', 'Queued one'));
    await flushPromises();
    expect(busyNet('beaver')).toBe(2);
    jobs.cancel({ agent: 'beaver' });
    expect(busyNet('beaver')).toBe(0);
  });

  it('a job cancelled while its animal is waking never takes a busy hold', async () => {
    presence.presence.set('ants', 'docked');
    jobs.submit(req('ants', 'Plan the week'));
    jobs.cancel({ agent: 'ants' });
    await flushPromises();
    expect(log.filter((l) => l.startsWith('busy:ants'))).toEqual([]);
    expect(runner.calls).toHaveLength(0);
  });

  it('C8 cancel one animal: running aborted, queued dropped, others continue', async () => {
    const s1 = jobs.submit(req('eagle', 'First'));
    const s2 = jobs.submit(req('eagle', 'Second'));
    jobs.submit(req('workspace', 'Check email'));
    await flushPromises();
    const scoutSignal = runner.calls[0].ctx.signal;

    expect(jobs.cancel({ agent: 'eagle' })).toBe(2);
    expect(scoutSignal.aborted).toBe(true);
    expect(runner.calls[1].ctx.signal.aborted).toBe(false);
    expect(ofType('job.update').filter((e) => e.state === 'cancelled').map((e) => e.jobId)).toEqual([s1.jobId, s2.jobId]);
    expect(log).toContain('busy:eagle:false');

    // A late result from the cancelled job is ignored, and the queued one never starts.
    runner.calls[0].resolve(ok());
    await clock.advanceAsync(NORMAL_JOB_TIMEOUT_MS * 2 - 1);
    expect(runner.calls).toHaveLength(2);
    expect(ofType('agent.say')).toHaveLength(1);                       // only Pixel's timeout report
    expect(ofType('agent.say')[0].agentId).toBe('workspace');
  });

  it('C8b Pixel finishes normally after Scout is cancelled', async () => {
    jobs.submit(req('eagle', 'First'));
    const p = jobs.submit(req('workspace', 'Check email'));
    await flushPromises();
    jobs.cancel({ agent: 'eagle' });
    runner.calls[1].resolve(ok());
    await expect(jobs.waitFor(p.jobId!)).resolves.toMatchObject({ ok: true });
    expect(jobs.list().find((j) => j.jobId === p.jobId)?.state).toBe('done');
  });

  it('cancel all: everything cancelled, no say/return, onFinished not called, waitFor resolves Cancelled.', async () => {
    const onFinished = vi.fn();
    jobs.onFinished(onFinished);
    const a = jobs.submit(req('eagle', 'First'));
    jobs.submit(req('eagle', 'Second'));
    jobs.submit(req('workspace', 'Check email'));
    jobs.submit(req('beaver', 'Find file', { kind: 'help', requestedBy: 'workspace' }));
    await flushPromises();

    expect(jobs.cancel({ all: true })).toBe(4);
    expect(runner.calls.every((c) => c.ctx.signal.aborted)).toBe(true);
    await expect(jobs.waitFor(a.jobId!)).resolves.toEqual({ ok: false, say: '', bubble: '', summary: 'Cancelled.', artifacts: [] });

    runner.calls.forEach((c) => c.resolve(ok()));
    await clock.advanceAsync(10 * 60_000);
    expect(ofType('agent.say')).toHaveLength(0);
    expect(ofType('agent.return')).toHaveLength(0);
    expect(onFinished).not.toHaveBeenCalled();
    expect(runner.calls).toHaveLength(3);
    expect(jobs.list().every((j) => j.state === 'cancelled')).toBe(true);
    expect(jobs.cancel({ all: true })).toBe(0);
  });

  it('C10 auto-wake: docked Swarm → woke_and_started; wake before run', async () => {
    presence.presence.set('ants', 'docked');
    expect(jobs.submit(req('ants', 'Plan my day')).status).toBe('woke_and_started');
    await flushPromises();
    expect(log.indexOf('wake:ants:job')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('wake:ants:job')).toBeLessThan(log.indexOf('run:ants'));
    expect(log.indexOf('busy:ants:true')).toBeLessThan(log.indexOf('run:ants'));

    // Sleeping animals are woken too, but the status stays 'started'.
    presence.presence.set('beaver', 'sleeping');
    expect(jobs.submit(req('beaver', 'Find file')).status).toBe('started');
    await flushPromises();
    expect(log.indexOf('wake:beaver:job')).toBeLessThan(log.indexOf('run:beaver'));
  });

  it('C11 approval pause: the working-time clock stops while paused', async () => {
    const a = jobs.submit(req('workspace', 'Create event'));
    await flushPromises();
    await clock.advanceAsync(10_000);
    jobs.pauseClock(a.jobId!);
    jobs.pauseClock(a.jobId!);                                         // pausing twice is a no-op
    await clock.advanceAsync(4 * 60_000);
    jobs.resumeClock(a.jobId!);
    await clock.advanceAsync(NORMAL_JOB_TIMEOUT_MS - 10_000 - 1);
    expect(runner.calls[0].ctx.signal.aborted).toBe(false);
    expect(jobs.list()[0].state).toBe('running');

    runner.calls[0].resolve(ok());
    await expect(jobs.waitFor(a.jobId!)).resolves.toMatchObject({ ok: true });
    expect(jobs.list()[0].state).toBe('done');
  });

  it('pause/resume are no-ops for unknown or finished jobs; resume after pause re-arms the remainder', async () => {
    expect(() => jobs.pauseClock('nope')).not.toThrow();
    expect(() => jobs.resumeClock('nope')).not.toThrow();
    const a = jobs.submit(req('workspace', 'Create event'));
    await flushPromises();
    jobs.resumeClock(a.jobId!);                                        // not paused → no-op, no double timer
    await clock.advanceAsync(30_000);
    jobs.pauseClock(a.jobId!);
    await clock.advanceAsync(60_000);
    jobs.resumeClock(a.jobId!);
    await clock.advanceAsync(NORMAL_JOB_TIMEOUT_MS - 30_000 - 1);
    expect(jobs.list()[0].state).toBe('running');
    await clock.advanceAsync(1);
    expect(jobs.list()[0].state).toBe('failed');
    jobs.pauseClock(a.jobId!);
    jobs.resumeClock(a.jobId!);
    expect(clock.pending()).toBe(0);
  });

  it('timeout fires at exactly 180 s of working time and aborts the signal', async () => {
    const a = jobs.submit(req('eagle', 'Slow search'));
    await flushPromises();
    await clock.advanceAsync(NORMAL_JOB_TIMEOUT_MS - 1);
    expect(runner.calls[0].ctx.signal.aborted).toBe(false);
    expect(jobs.list()[0].state).toBe('running');
    await clock.advanceAsync(1);
    expect(runner.calls[0].ctx.signal.aborted).toBe(true);
    const timedOut = { ok: false, say: 'I ran out of time.', bubble: 'Timed out', summary: 'Timed out after 180 s.', artifacts: [] };
    await expect(jobs.waitFor(a.jobId!)).resolves.toEqual(timedOut);
    expect(ofType('agent.say')[0]).toMatchObject({ agentId: 'eagle', text: 'I ran out of time.', bubble: 'Timed out', priority: 'report' });
    expect(ofType('agent.return')[0]).toMatchObject({ ok: false, summary: 'Timed out after 180 s.' });

    // The runner's late answer is ignored.
    runner.calls[0].resolve(ok());
    await flushPromises();
    expect(ofType('agent.say')).toHaveLength(1);
    expect(jobs.list()[0].state).toBe('failed');
  });

  it('help timeout fires at 60 s', async () => {
    jobs.submit(req('eagle', 'Main job'));
    const h = jobs.submit(req('eagle', 'Quick lookup', { kind: 'help', requestedBy: 'workspace' }));
    await flushPromises();
    await clock.advanceAsync(HELP_JOB_TIMEOUT_MS - 1);
    expect(runner.calls[1].ctx.signal.aborted).toBe(false);
    await clock.advanceAsync(1);
    expect(runner.calls[1].ctx.signal.aborted).toBe(true);
    expect(runner.calls[0].ctx.signal.aborted).toBe(false);
    await expect(jobs.waitFor(h.jobId!)).resolves.toMatchObject({ ok: false, summary: 'Timed out after 60 s.' });
  });

  it('event order on start and finish matches §8; via ants only with planStep', async () => {
    const a = jobs.submit(req('eagle', 'Pizza near campus', { parentTaskId: 'task-9' }));
    await flushPromises();
    expect(events.map((e) => e.type)).toEqual(['job.update', 'agent.handoff']);
    expect(events[0]).toMatchObject({ agentId: 'chipmunk', to: 'eagle', state: 'running', title: 'Pizza near campus', requestedBy: 'chipmunk', taskId: 'task-9' });
    expect(events[1]).toMatchObject({ agentId: 'chipmunk', to: 'eagle', task: 'Pizza near campus', taskId: 'task-9' });
    expect('via' in events[1]).toBe(false);

    events.length = 0;
    runner.calls[0].resolve(ok('x'.repeat(400)));
    await jobs.waitFor(a.jobId!);
    expect(events.map((e) => e.type)).toEqual(['agent.say', 'agent.return', 'job.update', 'agent.status']);
    expect(events[0]).toMatchObject({ agentId: 'eagle', text: 'Found it!', bubble: 'Done', priority: 'report', taskId: 'task-9' });
    expect(events[1]).toMatchObject({ agentId: 'eagle', to: 'chipmunk', ok: true, taskId: 'task-9' });
    expect((events[1] as Extract<BiomeEvent, { type: 'agent.return' }>).summary).toHaveLength(300);
    expect(events[2]).toMatchObject({ agentId: 'chipmunk', state: 'done', taskId: 'task-9' });

    events.length = 0;
    jobs.submit(req('workspace', 'Block study time', { planStep: 2 }));
    await flushPromises();
    expect(ofType('agent.handoff')[0]).toMatchObject({ to: 'workspace', via: 'ants' });
  });

  it('completes even when reporting throws after the speech event', async () => {
    const originalEmit = bus.emit.bind(bus);
    vi.spyOn(bus, 'emit').mockImplementation((input) => {
      const event = originalEmit(input);
      if (input.type === 'agent.say' && input.agentId === 'eagle') throw new Error('report transport failed');
      return event;
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFinished = vi.fn();
    jobs.onFinished(onFinished);
    const submitted = jobs.submit(req('eagle', 'Search web'));
    await flushPromises();
    runner.calls[0].resolve({ ok: true, say: 'Found NASA.', bubble: 'Found', summary: 'NASA source.', artifacts: [] });
    await expect(jobs.waitFor(submitted.jobId!)).resolves.toMatchObject({ ok: true, summary: 'NASA source.' });
    expect(events.filter(e => ['agent.say', 'agent.return', 'job.update'].includes(e.type)).slice(-3)
      .map(e => e.type)).toEqual(['agent.say', 'agent.return', 'job.update']);
    expect(onFinished).toHaveBeenCalledOnce();
    expect(jobs.list().find(j => j.jobId === submitted.jobId)?.state).toBe('done');
    expect(busyNet('eagle')).toBe(0);
    errors.mockRestore();
  });

  it('derives missing result fields before emitting the terminal events', async () => {
    const submitted = jobs.submit(req('beaver', 'Find a file'));
    await flushPromises();
    runner.calls[0].resolve({ ok: true, say: 'Found the file.' } as AgentResult);
    await expect(jobs.waitFor(submitted.jobId!)).resolves.toMatchObject({ ok: true, summary: 'Found the file.' });
    expect(ofType('agent.return').at(-1)?.summary).toBe('Found the file.');
    expect(ofType('job.update').at(-1)?.state).toBe('done');
  });

  it('runner throws → failed with the error message; the next queued job starts', async () => {
    const onFinished = vi.fn();
    jobs.onFinished(() => { throw new Error('bad callback'); });
    jobs.onFinished(onFinished);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = jobs.submit(req('beaver', 'First'));
    jobs.submit(req('beaver', 'Second'));
    await flushPromises();
    runner.calls[0].reject(new Error('disk on fire'));
    await expect(jobs.waitFor(a.jobId!)).resolves.toEqual({ ok: false, say: 'Something went wrong.', bubble: 'Oops', summary: 'disk on fire', artifacts: [] });
    await flushPromises();
    expect(jobs.list().find((j) => j.jobId === a.jobId)?.state).toBe('failed');
    expect(onFinished).toHaveBeenCalledTimes(1);                       // a throwing callback doesn't stop the others
    expect(onFinished.mock.calls[0][0]).toMatchObject({ jobId: a.jobId, state: 'failed' });
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[1].task).toBe('Do: Second');
    err.mockRestore();
  });

  it('not_installed for an extra (butterfly) with default settings; no events', () => {
    expect(jobs.submit(req('butterfly', 'Draft a post'))).toEqual({ status: 'not_installed' });
    expect(events).toHaveLength(0);
    expect(jobs.list()).toHaveLength(0);
  });

  it('setBusy(true) on start; setBusy(false) + touch on finish', async () => {
    const a = jobs.submit(req('eagle', 'Search'));
    await flushPromises();
    expect(log).toEqual(['busy:eagle:true', 'run:eagle']);
    runner.calls[0].resolve(ok());
    await jobs.waitFor(a.jobId!);
    expect(log).toEqual(['busy:eagle:true', 'run:eagle', 'busy:eagle:false', 'touch:eagle']);
  });

  it('waitFor: unknown rejects; finished resolves; list keeps finished jobs for 10 minutes', async () => {
    await expect(jobs.waitFor('nope')).rejects.toThrow();
    const a = jobs.submit(req('eagle', 'Search'));
    await flushPromises();
    runner.calls[0].resolve(ok());
    await flushPromises();
    await expect(jobs.waitFor(a.jobId!)).resolves.toEqual(ok());
    await clock.advanceAsync(10 * 60_000);
    expect(jobs.list()).toHaveLength(1);
    await clock.advanceAsync(1);
    expect(jobs.list()).toHaveLength(0);
    await expect(jobs.waitFor(a.jobId!)).resolves.toEqual(ok());

    // list() returns copies.
    jobs.submit(req('eagle', 'Another'));
    jobs.list()[0].state = 'done';
    expect(jobs.list()[0].state).toBe('running');
  });
});
