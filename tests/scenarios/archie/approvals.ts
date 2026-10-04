import type { ArchieContext } from '../../../src/main/chipCore';
import type {
  ApprovalHow, ApprovalOutcome, ApprovalRequest, Approvals, GateRequest, WardenGate, WardenVerdict,
} from '../../../src/main/runtime/types';

/**
 * Stand-ins for Warden's gate and Approvals service, used by the Archie scenarios and `/sandbox` in chip-cli.
 * Warden's own lanes come later: the real Warden replaces BOTH of these. Nothing here imports vitest, so the CLI can use it.
 */

/** What the scripted user does with the next approval card. */
export type Decision = 'approve' | 'decline' | 'hold';

/**
 * Warden's rules as far as Archie needs them (spec §13): deny external (W1), ask on write (W3) and destructive (W4),
 * allow undo of ADE's own batches (W11), allow reads (W2). Emits `wolf.verdict` like the real gate will.
 * The repo's StubWardenGate only denies/allows, so it can never ask; this is the smallest gate that can.
 */
export class AskingWardenGate implements WardenGate {
  private readonly last = new Map<string, { rule: string; reason: string }>();
  constructor(private readonly ctx: Pick<ArchieContext, 'bus'>) {}

  review(r: GateRequest): WardenVerdict {
    let verdict: WardenVerdict;
    let rule: string;
    let reason: string;
    if (r.risk === 'external') { verdict = 'deny'; rule = 'W1'; reason = 'ADE never sends or posts for you.'; }
    else if (r.tool === 'fs_undo') { verdict = 'allow'; rule = 'W11'; reason = "Undoing ADE's own change needs no approval."; }
    else if (r.risk === 'destructive') { verdict = 'ask'; rule = 'W4'; reason = 'Deleting asks first.'; }
    else if (r.risk === 'write') { verdict = 'ask'; rule = 'W3'; reason = 'Changing files asks first.'; }
    else { verdict = 'allow'; rule = 'W2'; reason = `${r.tool} only reads.`; }
    this.last.set(r.callId, { rule, reason });
    this.ctx.bus.emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: r.taskId, callId: r.callId, verdict, rule, reason });
    return verdict;
  }

  explain(callId: string): { rule: string; reason: string } | undefined {
    return this.last.get(callId);
  }
}

interface Waiting { request: ApprovalRequest; expiresAt: number; settle(outcome: ApprovalOutcome): void }

/**
 * A user who answers from a script: `approve`, `decline`, or `hold` (wait until the test calls `resolve`).
 * Like the real service it pauses the job's clock for as long as a card is pending, and emits
 * `approval.request` / `approval.resolve`.
 */
export class ScriptedApprovals implements Approvals {
  /** Every card shown, in order (titles and previews: never file contents). */
  readonly requests: ApprovalRequest[] = [];
  private readonly script: Decision[];
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly ctx: ArchieContext, script: Decision[] = [], private readonly fallback: Decision = 'approve') {
    this.script = [...script];
  }

  /** Queue more answers for the next cards. */
  answer(...decisions: Decision[]): void {
    this.script.push(...decisions);
  }

  async request(r: ApprovalRequest): Promise<ApprovalOutcome> {
    const { bus, jobs, clock } = this.ctx;
    this.requests.push(r);
    bus.emit({ type: 'approval.request', agentId: 'wolf', taskId: r.taskId, callId: r.callId, title: r.title, preview: r.preview });
    jobs.pauseClock(r.jobId);
    let outcome: ApprovalOutcome;
    try {
      const decision = this.script.shift() ?? this.fallback;
      if (decision === 'hold') {
        outcome = await new Promise<ApprovalOutcome>((resolve) => {
          const settle = (o: ApprovalOutcome): void => { r.signal.removeEventListener('abort', onAbort); this.waiting.delete(r.callId); resolve(o); };
          const onAbort = (): void => settle({ approved: false, how: 'cancelled' });
          this.waiting.set(r.callId, { request: r, expiresAt: clock.now() + 5 * 60_000, settle });
          if (r.signal.aborted) onAbort(); else r.signal.addEventListener('abort', onAbort, { once: true });
        });
      } else {
        outcome = { approved: decision === 'approve', how: 'user' };
      }
    } finally {
      jobs.resumeClock(r.jobId);
    }
    const how: ApprovalHow = outcome.how;
    bus.emit({ type: 'approval.resolve', agentId: 'wolf', taskId: r.taskId, callId: r.callId, approved: outcome.approved, how });
    return outcome;
  }

  resolve(callId: string, approved: boolean): void {
    this.waiting.get(callId)?.settle({ approved, how: 'user' });
  }

  cancelForJobs(jobIds: string[]): void {
    for (const w of [...this.waiting.values()]) if (jobIds.includes(w.request.jobId)) w.settle({ approved: false, how: 'cancelled' });
  }

  pending(): { callId: string; jobId: string; agentId: ApprovalRequest['agentId']; title: string; expiresAt: number }[] {
    return [...this.waiting.values()].map((w) => ({
      callId: w.request.callId, jobId: w.request.jobId, agentId: w.request.agentId, title: w.request.title, expiresAt: w.expiresAt,
    }));
  }

  dispose(): void {
    for (const w of [...this.waiting.values()]) w.settle({ approved: false, how: 'cancelled' });
  }
}
