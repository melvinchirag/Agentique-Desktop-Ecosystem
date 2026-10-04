import { randomUUID } from 'node:crypto';
import type { AdeSettings } from '../../shared/ipc';
import type {
  AgentResult, Bus, Clock, Job, JobRequest, JobScheduler, PresenceManager, SpecialistId, SpecialistRunner, SubmitStatus, TimerHandle,
} from './types';

/**
 * JobScheduler (Chip spec §3, §4.1, §8): every animal's job queue.
 * - Different animals run in parallel; one animal runs one normal job at a time (FIFO).
 * - Help jobs skip the line and never enter or block the queue.
 * - Safety timeout counts working time only; pauseClock/resumeClock wrap Warden approvals.
 */

export interface JobSchedulerDeps {
  bus: Bus; clock: Clock; runner: SpecialistRunner; presence: PresenceManager;
  settings: () => AdeSettings;
  newId?: () => string;            // default crypto.randomUUID
}

export const NORMAL_JOB_TIMEOUT_MS = 180_000;
export const HELP_JOB_TIMEOUT_MS = 60_000;

const FINISHED_LIST_WINDOW_MS = 10 * 60_000;
const RETURN_SUMMARY_MAX = 300;

/** Lowercase, trim, strip punctuation, collapse spaces. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface JobRecord {
  job: Job;
  controller: AbortController;
  timeoutMs: number;
  remainingMs: number;
  timer: TimerHandle | null;
  armedAt: number;
  armed: boolean;                  // the runner has been called; the working-time clock applies
  paused: boolean;
  busyHeld: boolean;               // this job called presence.setBusy(true) and hasn't released it yet
  resolve: (r: AgentResult) => void;
  done: Promise<AgentResult>;
}

const CANCELLED_RESULT: AgentResult = { ok: false, say: '', bubble: '', summary: 'Cancelled.', artifacts: [] };

export function createJobScheduler(deps: JobSchedulerDeps): JobScheduler {
  const { bus, clock, runner, presence, settings } = deps;
  const newId = deps.newId ?? randomUUID;

  const records = new Map<string, JobRecord>();                 // every job ever submitted, in submit order
  const runningNormal = new Map<SpecialistId, JobRecord>();     // at most one per agent
  const queues = new Map<SpecialistId, JobRecord[]>();          // FIFO of queued normal jobs
  const finishedCbs: ((job: Job, result: AgentResult) => void)[] = [];

  function emitJobUpdate(job: Job): void {
    bus.emit({
      type: 'job.update', agentId: job.requestedBy, taskId: job.parentTaskId,
      jobId: job.jobId, to: job.agent, state: job.state, title: job.title, requestedBy: job.requestedBy,
      ...(job.state === 'queued' && job.position !== undefined ? { position: job.position } : {}),
    });
  }

  function queueOf(agent: SpecialistId): JobRecord[] {
    let q = queues.get(agent);
    if (!q) {
      q = [];
      queues.set(agent, q);
    }
    return q;
  }

  /** PresenceManager counts setBusy calls, so every job releases exactly the hold it took. */
  function releaseBusy(rec: JobRecord): void {
    if (!rec.busyHeld) return;
    rec.busyHeld = false;
    presence.setBusy(rec.job.agent, false);
  }

  function makeRecord(req: JobRequest): JobRecord {
    let resolve!: (r: AgentResult) => void;
    const done = new Promise<AgentResult>((r) => { resolve = r; });
    const timeoutMs = req.kind === 'help' ? HELP_JOB_TIMEOUT_MS : NORMAL_JOB_TIMEOUT_MS;
    const job: Job = {
      jobId: newId(), agent: req.agent, task: req.task, title: req.title, requestedBy: req.requestedBy,
      kind: req.kind, parentTaskId: req.parentTaskId, state: 'queued',
      ...(req.nextStep !== undefined ? { nextStep: req.nextStep } : {}),
      ...(req.planStep !== undefined ? { planStep: req.planStep } : {}),
    };
    return {
      job, controller: new AbortController(), timeoutMs, remainingMs: timeoutMs,
      timer: null, armedAt: 0, armed: false, paused: false, busyHeld: false, resolve, done,
    };
  }

  // ── Working-time timeout ────────────────────────────────

  function armTimer(rec: JobRecord): void {
    if (rec.job.state !== 'running' || rec.paused || rec.timer !== null) return;
    rec.armedAt = clock.now();
    rec.timer = clock.setTimeout(() => onTimeout(rec), rec.remainingMs);
  }

  function clearTimer(rec: JobRecord): void {
    if (rec.timer === null) return;
    clock.clearTimeout(rec.timer);
    rec.timer = null;
  }

  function onTimeout(rec: JobRecord): void {
    rec.timer = null;
    if (rec.job.state !== 'running') return;
    rec.controller.abort();
    const secs = Math.round(rec.timeoutMs / 1000);
    finish(rec, { ok: false, say: 'I ran out of time.', bubble: 'Timed out', summary: `Timed out after ${secs} s.`, artifacts: [] });
  }

  // ── Start / finish ──────────────────────────────────────

  async function start(rec: JobRecord): Promise<void> {
    const { job } = rec;
    job.state = 'running';
    delete job.position;

    const p = presence.get(job.agent);
    if (p === 'docked' || p === 'sleeping') {
      try {
        await presence.wake(job.agent, 'job');
      } catch {
        // Waking is cosmetic; the job still runs.
      }
      if (job.state !== 'running') return;                     // cancelled while waking
    }

    presence.setBusy(job.agent, true);
    rec.busyHeld = true;
    job.startedAt = clock.now();
    emitJobUpdate(job);
    bus.emit({
      type: 'agent.handoff', agentId: job.requestedBy, taskId: job.parentTaskId, to: job.agent, task: job.title,
      ...(job.planStep !== undefined ? { via: 'ants' as const } : {}),
    });

    let run: Promise<AgentResult>;
    try {
      run = runner.run(job.agent, job.task, { jobId: job.jobId, taskId: job.parentTaskId, kind: job.kind, signal: rec.controller.signal });
    } catch (err) {
      run = Promise.reject(err);
    }
    rec.armed = true;
    armTimer(rec);

    run.then(
      (result) => finish(rec, result),
      (err: unknown) => finish(rec, {
        ok: false, say: 'Something went wrong.', bubble: 'Oops',
        summary: err instanceof Error ? err.message : String(err), artifacts: [],
      }),
    );
  }

  function finish(rec: JobRecord, result: AgentResult): void {
    const { job } = rec;
    if (job.state !== 'running') return;                       // cancelled or timed out already
    clearTimer(rec);
    // A runner (including an older plugin) can resolve with incomplete fields. Never let
    // rendering a report strand a job after its model has already answered.
    const raw = result as Partial<AgentResult> | null | undefined;
    const answer = typeof raw?.summary === 'string' && raw.summary.trim()
      ? raw.summary : typeof raw?.say === 'string' && raw.say.trim() ? raw.say : '';
    const summary = answer || 'The specialist returned no result.';
    const ok = raw?.ok === true && Boolean(answer);
    const complete: AgentResult = {
      ok,
      summary,
      say: typeof raw?.say === 'string' && raw.say.trim() ? raw.say : summary.split(/\r?\n/)[0]!.slice(0, 120),
      bubble: typeof raw?.bubble === 'string' && raw.bubble.trim() ? raw.bubble : ok ? 'Done' : 'Snag',
      artifacts: Array.isArray(raw?.artifacts) ? raw.artifacts : [],
    };
    job.state = complete.ok ? 'done' : 'failed';
    job.finishedAt = clock.now();
    if (job.kind === 'normal' && runningNormal.get(job.agent) === rec) runningNormal.delete(job.agent);

    const safe = (step: string, action: () => void): void => {
      try { action(); } catch (err) { console.error(`[jobs] ${step} failed`, err); }
    };
    safe('report', () => { bus.emit({ type: 'agent.say', agentId: job.agent, taskId: job.parentTaskId,
      text: complete.say, bubble: complete.bubble, priority: 'report' }); });
    safe('return', () => { bus.emit({
      type: 'agent.return', agentId: job.agent, taskId: job.parentTaskId, to: job.requestedBy,
      ok: complete.ok, summary: complete.summary.slice(0, RETURN_SUMMARY_MAX),
    }); });
    safe('job update', () => { emitJobUpdate(job); });

    // A help job can finish while the animal's own job is still running; the other job's hold keeps it awake.
    safe('release busy', () => { releaseBusy(rec); });
    safe('touch presence', () => { presence.touch(job.agent); });
    safe('idle status', () => { bus.emit({ type: 'agent.status', agentId: job.agent,
      taskId: job.parentTaskId, status: 'idle' }); });

    const snapshot = { ...job };
    for (const cb of finishedCbs) {
      try {
        cb(snapshot, complete);
      } catch (err) {
        console.error('[jobs] onFinished callback failed', err);
      }
    }
    rec.resolve(complete);

    if (job.kind === 'normal') startNext(job.agent);
  }

  function startNext(agent: SpecialistId): void {
    if (runningNormal.has(agent)) return;
    const q = queueOf(agent);
    const next = q.shift();
    if (!next) return;
    runningNormal.set(agent, next);
    q.forEach((rec, i) => {
      rec.job.position = i + 1;
      emitJobUpdate(rec.job);
    });
    void start(next);
  }

  // ── Public API ──────────────────────────────────────────

  return {
    submit(req) {
      if (!settings().installed[req.agent]) return { status: 'not_installed' };

      if (req.kind === 'help') {
        const rec = makeRecord(req);
        records.set(rec.job.jobId, rec);
        const status: SubmitStatus = presence.get(req.agent) === 'docked' ? 'woke_and_started' : 'started';
        void start(rec);
        return { status, jobId: rec.job.jobId };
      }

      const key = normalizeTitle(req.title);
      const running = runningNormal.get(req.agent);
      const candidates = [...(running ? [running] : []), ...queueOf(req.agent)];
      const dup = candidates.find((r) => normalizeTitle(r.job.title) === key);
      if (dup) return { status: 'duplicate', jobId: dup.job.jobId };

      const rec = makeRecord(req);
      records.set(rec.job.jobId, rec);

      if (running) {
        const q = queueOf(req.agent);
        q.push(rec);
        rec.job.position = q.length;
        emitJobUpdate(rec.job);
        return { status: 'queued', jobId: rec.job.jobId, position: rec.job.position };
      }

      runningNormal.set(req.agent, rec);
      const status: SubmitStatus = presence.get(req.agent) === 'docked' ? 'woke_and_started' : 'started';
      void start(rec);
      return { status, jobId: rec.job.jobId };
    },

    waitFor(jobId) {
      const rec = records.get(jobId);
      if (!rec) return Promise.reject(new Error(`Unknown job: ${jobId}`));
      return rec.done;
    },

    cancel(filter) {
      const matches = (agent: SpecialistId): boolean => filter.all === true || (filter.agent !== undefined && filter.agent === agent);
      const hit: JobRecord[] = [];
      for (const rec of records.values()) {
        const { state, agent } = rec.job;
        if ((state === 'running' || state === 'queued') && matches(agent)) hit.push(rec);
      }

      for (const rec of hit) {
        const { job } = rec;
        if (job.state === 'running') {
          rec.controller.abort();
          clearTimer(rec);
          if (runningNormal.get(job.agent) === rec) runningNormal.delete(job.agent);
        } else {
          const q = queueOf(job.agent);
          const i = q.indexOf(rec);
          if (i >= 0) q.splice(i, 1);
        }
        job.state = 'cancelled';
        delete job.position;
        job.finishedAt = clock.now();
        emitJobUpdate(job);
        rec.resolve({ ...CANCELLED_RESULT, artifacts: [] });
        releaseBusy(rec);
      }

      return hit.length;
    },

    list() {
      const cutoff = clock.now() - FINISHED_LIST_WINDOW_MS;
      const out: Job[] = [];
      for (const { job } of records.values()) {
        const live = job.state === 'running' || job.state === 'queued';
        if (live || (job.finishedAt !== undefined && job.finishedAt >= cutoff)) out.push({ ...job });
      }
      return out;
    },

    onFinished(cb) {
      finishedCbs.push(cb);
    },

    pauseClock(jobId) {
      const rec = records.get(jobId);
      if (!rec || rec.job.state !== 'running' || rec.paused) return;
      rec.paused = true;
      if (rec.timer !== null) {
        rec.remainingMs = Math.max(0, rec.remainingMs - (clock.now() - rec.armedAt));
        clearTimer(rec);
      }
    },

    resumeClock(jobId) {
      const rec = records.get(jobId);
      if (!rec || rec.job.state !== 'running' || !rec.paused) return;
      rec.paused = false;
      if (rec.armed) armTimer(rec);
    },
  };
}
