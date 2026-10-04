import type { AdeSettings } from '../../shared/ipc';
import type { Approvals, Bus, Clock, JobScheduler, PresenceManager } from '../runtime/types';
import { createApprovals } from './approvals';
import { WardenGateImpl, type WardenGateOptions } from './gate';
import { createInjectionScreen, type InjectionScreenDeps } from './injection';
import { inspectCall } from './inspect';
import { createWardenSpeaker } from './speaker';

export interface WardenOptions extends Omit<WardenGateOptions, 'settings'> {
  clock: Clock;
  jobs: JobScheduler;
  presence: PresenceManager;
  settings: () => AdeSettings;
  classifier?: InjectionScreenDeps['classifier'];
  classifierEnabled?: boolean;
}

/** Security stays synchronous and independent of Warden's visible presence. */
export function createWarden(options: WardenOptions) {
  const { bus, clock, jobs, presence } = options;
  const gate = new WardenGateImpl({ ...options, settings: {
    get allowedFolders() { return options.settings().allowedFolders; },
    get demoMode() { return options.settings().demoMode; },
  } });
  const calls = new Map<string, { jobId: string; key: string; tool: string; count?: number }>();
  const review = gate.review.bind(gate);
  gate.review = request => {
    // Keep only the canonical identity in memory; audit args may intentionally be redacted.
    try {
      const tools = typeof options.registry === 'function' ? options.registry(request.agentId) : options.registry[request.agentId];
      const tool = tools?.find(candidate => candidate.name === request.tool);
      calls.set(request.callId, { jobId: request.jobId, key: gate.callKey(request.tool, request.args),
        tool: request.tool, count: inspectCall(request.args, tool).count });
    } catch { /* The gate itself emits the fail-closed decision. */ }
    return review(request);
  };
  const innerApprovals = createApprovals({ bus, clock, jobs, onDeclined: request => {
    const call = calls.get(request.callId);
    if (call && call.jobId === request.jobId) gate.noteDeclined(request.jobId, call.key);
  } });
  let busy = false;
  let disposed = false;
  const syncBusy = (): void => {
    const next = innerApprovals.pending().length > 0;
    if (next !== busy) { busy = next; presence.setBusy('wolf', next); }
  };
  const approvals: Approvals = {
    request(request) {
      const result = innerApprovals.request(request);
      syncBusy();
      return result.finally(syncBusy);
    },
    resolve(callId, approved) { innerApprovals.resolve(callId, approved); syncBusy(); },
    cancelForJobs(ids) { innerApprovals.cancelForJobs(ids); syncBusy(); },
    pending: () => innerApprovals.pending(),
    dispose() { innerApprovals.dispose(); syncBusy(); },
  };
  const screen = createInjectionScreen({ bus, clock, classifier: options.classifier,
    classifierEnabled: options.classifierEnabled, onFlag: taskId => gate.taint(taskId) });
  const speaker = createWardenSpeaker({ bus, clock,
    countForCall: callId => calls.get(callId)?.count, toolForCall: callId => calls.get(callId)?.tool });
  const off = bus.subscribe(event => {
    if (event.type === 'wolf.alert' || event.type === 'approval.request'
      || (event.type === 'wolf.verdict' && event.verdict !== 'allow')) {
      try { if (presence.get('wolf') !== 'active') void presence.wake('wolf', 'job').catch(() => undefined); }
      catch { /* Visible presence must never affect the decision. */ }
    }
    if (event.type === 'approval.request' || event.type === 'approval.resolve') syncBusy();
    if (event.type === 'job.update' && ['done', 'failed', 'cancelled'].includes(event.state)) {
      for (const [id, call] of calls) if (call.jobId === event.jobId) calls.delete(id);
    }
  });
  return { gate, approvals, screen, speaker, dispose(): void {
    if (disposed) return;
    disposed = true;
    try { approvals.dispose(); }
    finally { off(); speaker.dispose(); gate.dispose(); calls.clear(); }
  } };
}

export type Warden = ReturnType<typeof createWarden>;
