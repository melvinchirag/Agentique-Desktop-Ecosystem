import type { ApprovalHow, ApprovalOutcome, ApprovalRequest, Approvals, Bus, Clock, JobScheduler, TimerHandle } from '../runtime/types';

export interface ApprovalsDeps {
  bus: Bus;
  clock: Clock;
  jobs: Pick<JobScheduler, 'list' | 'pauseClock' | 'resumeClock'>;
  /** Lets the gate remember a declined call for W9. */
  onDeclined?: (request: ApprovalRequest) => void;
}

export const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const MAX_VISIBLE = 3;

interface Entry {
  request: ApprovalRequest;
  pausedJobs: string[];
  visible: boolean;
  waitingEmitted: boolean;
  expiresAt: number;
  timer: TimerHandle | null;
  resolve: (outcome: ApprovalOutcome) => void;
  onAbort: () => void;
}

export function createApprovals({ bus, clock, jobs, onDeclined }: ApprovalsDeps): Approvals {
  const entries = new Map<string, Entry>();
  const pauseRefs = new Map<string, number>();
  let disposed = false;
  let pumping = false;
  let pumpAgain = false;

  function pausedJobIds(request: ApprovalRequest): string[] {
    const ids = new Set([request.jobId]);
    const help = jobs.list().find((job) => job.jobId === request.jobId && job.kind === 'help');
    if (help) {
      const parent = jobs.list().find((job) =>
        job.kind === 'normal' && job.state === 'running' &&
        job.agent === help.requestedBy && job.parentTaskId === help.parentTaskId,
      );
      if (parent) ids.add(parent.jobId);
    }
    return [...ids];
  }

  function pause(jobId: string): void {
    const count = pauseRefs.get(jobId) ?? 0;
    if (count === 0) jobs.pauseClock(jobId);
    pauseRefs.set(jobId, count + 1);
  }

  function resume(jobId: string): void {
    const count = pauseRefs.get(jobId);
    if (count === undefined) return;
    if (count > 1) pauseRefs.set(jobId, count - 1);
    else {
      pauseRefs.delete(jobId);
      jobs.resumeClock(jobId);
    }
  }

  function show(entry: Entry): void {
    const { request } = entry;
    if (request.signal.aborted) { settle(entry, false, 'cancelled'); return; }
    entry.visible = true;
    entry.expiresAt = clock.now() + APPROVAL_TIMEOUT_MS;
    entry.timer = clock.setTimeout(() => settle(entry, false, 'timeout'), APPROVAL_TIMEOUT_MS);
    bus.emit({ type: 'approval.request', agentId: 'wolf', taskId: request.taskId,
      callId: request.callId, title: request.title, preview: request.preview });
    if (entries.get(request.callId) !== entry) return; // The UI subscriber may cancel synchronously.
    entry.waitingEmitted = true;
    bus.emit({ type: 'agent.status', agentId: request.agentId, taskId: request.taskId,
      status: 'waiting_approval' });
  }

  function pump(): void {
    if (disposed) return;
    if (pumping) { pumpAgain = true; return; }
    pumping = true;
    try {
      do {
        pumpAgain = false;
        let visible = [...entries.values()].filter((entry) => entry.visible).length;
        const visibleJobs = new Set([...entries.values()].filter((entry) => entry.visible).map((entry) => entry.request.jobId));
        // In insertion order, show the oldest eligible request. A second ask in
        // one job cannot hide a card from another job while a slot is available.
        for (const entry of entries.values()) {
          if (visible >= MAX_VISIBLE) break;
          if (entry.visible || visibleJobs.has(entry.request.jobId)) continue;
          visibleJobs.add(entry.request.jobId);
          visible++;
          show(entry);
        }
      } while (pumpAgain);
    } finally {
      pumping = false;
    }
  }

  function settle(entry: Entry, approved: boolean, how: ApprovalHow, refill = true): void {
    const { request } = entry;
    if (entries.get(request.callId) !== entry) return;
    entries.delete(request.callId);
    if (entry.timer !== null) clock.clearTimeout(entry.timer);
    request.signal.removeEventListener('abort', entry.onAbort);
    if (!approved) {
      try { onDeclined?.(request); } catch { /* A gate callback cannot keep an approval open. */ }
    }
    bus.emit({ type: 'approval.resolve', agentId: 'wolf', taskId: request.taskId,
      callId: request.callId, approved, how });
    if (entry.waitingEmitted) {
      bus.emit({ type: 'agent.status', agentId: request.agentId, taskId: request.taskId,
        status: 'working' });
    }
    for (const jobId of entry.pausedJobs) resume(jobId);
    entry.resolve({ approved, how });
    if (refill) pump();
  }

  return {
    request(request) {
      if (disposed || request.signal.aborted || entries.has(request.callId)) {
        return Promise.resolve({ approved: false, how: 'cancelled' });
      }
      return new Promise<ApprovalOutcome>((resolve) => {
        const entry: Entry = {
          request, pausedJobs: pausedJobIds(request), visible: false, waitingEmitted: false,
          expiresAt: Number.POSITIVE_INFINITY, timer: null, resolve,
          onAbort: () => settle(entry, false, 'cancelled'),
        };
        entries.set(request.callId, entry);
        for (const jobId of entry.pausedJobs) pause(jobId);
        request.signal.addEventListener('abort', entry.onAbort, { once: true });
        if (request.signal.aborted) settle(entry, false, 'cancelled');
        else pump();
      });
    },
    resolve(callId, approved) {
      const entry = entries.get(callId);
      if (entry?.visible) settle(entry, entry.request.signal.aborted ? false : approved,
        entry.request.signal.aborted ? 'cancelled' : 'user');
    },
    cancelForJobs(jobIds) {
      const ids = new Set(jobIds);
      for (const entry of [...entries.values()]) {
        if (ids.has(entry.request.jobId)) settle(entry, false, 'cancelled', false);
      }
      pump();
    },
    pending() {
      return [...entries.values()].map(({ request, expiresAt }) => ({
        callId: request.callId, jobId: request.jobId, agentId: request.agentId,
        title: request.title, expiresAt,
      }));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of [...entries.values()]) settle(entry, false, 'cancelled', false);
    },
  };
}
