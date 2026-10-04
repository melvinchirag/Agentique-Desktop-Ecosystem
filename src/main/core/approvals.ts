import type { ApprovalOutcome, ApprovalRequest, Approvals, Bus, Clock, JobScheduler, TimerHandle } from '../runtime/types';

/** UI approval boundary. Replace this factory when Warden supplies its own approvals. */
export function createApprovals(bus: Bus, clock: Clock, jobs: JobScheduler): Approvals {
  const waiting = new Map<string, { request: ApprovalRequest; expiresAt: number; timer: TimerHandle; finish: (outcome: ApprovalOutcome) => void }>();
  const paused = new Map<string, number>();
  const release = (jobId: string) => {
    const count = (paused.get(jobId) ?? 1) - 1;
    if (count > 0) paused.set(jobId, count);
    else { paused.delete(jobId); jobs.resumeClock(jobId); }
  };
  return {
    request(request) {
      if (request.signal.aborted) return Promise.resolve({ approved: false, how: 'cancelled' });
      if (waiting.has(request.callId)) return Promise.resolve({ approved: false, how: 'cancelled' });
      if (!paused.has(request.jobId)) jobs.pauseClock(request.jobId);
      paused.set(request.jobId, (paused.get(request.jobId) ?? 0) + 1);
      return new Promise<ApprovalOutcome>(resolve => {
        const finish = (outcome: ApprovalOutcome) => {
          const entry = waiting.get(request.callId);
          if (!entry) return;
          waiting.delete(request.callId);
          clock.clearTimeout(entry.timer);
          request.signal.removeEventListener('abort', abort);
          release(request.jobId);
          bus.emit({ type: 'approval.resolve', agentId: 'wolf', taskId: request.taskId, callId: request.callId, ...outcome });
          resolve(outcome);
        };
        const abort = () => finish({ approved: false, how: 'cancelled' });
        const timer = clock.setTimeout(() => finish({ approved: false, how: 'timeout' }), 5 * 60_000);
        waiting.set(request.callId, { request, expiresAt: clock.now() + 5 * 60_000, timer, finish });
        request.signal.addEventListener('abort', abort, { once: true });
        bus.emit({ type: 'approval.request', agentId: 'wolf', taskId: request.taskId, callId: request.callId,
          title: request.title, preview: request.preview });
      });
    },
    resolve(callId, approved) { waiting.get(callId)?.finish({ approved, how: 'user' }); },
    cancelForJobs(jobIds) { for (const entry of [...waiting.values()]) if (jobIds.includes(entry.request.jobId)) entry.finish({ approved: false, how: 'cancelled' }); },
    pending() { return [...waiting.values()].map(({ request, expiresAt }) => ({ callId: request.callId, jobId: request.jobId, agentId: request.agentId, title: request.title, expiresAt })); },
    dispose() { for (const entry of [...waiting.values()]) entry.finish({ approved: false, how: 'cancelled' }); },
  };
}
