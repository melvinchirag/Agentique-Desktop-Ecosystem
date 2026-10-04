import type { AgentId } from '../../shared/agents';
import type { Risk } from '../../shared/tools';
import type { Bus } from '../runtime/types';

export type StubVerdict = 'allow' | 'ask' | 'deny';

/** Stand-in for Warden's gate: deny external actions and ask before writes. */
export class StubWardenGate {
  constructor(private readonly bus: Bus) {}

  /** deny when risk is 'external' (rule 'W1'), else allow (rule 'W2'). Emits wolf.verdict (agentId 'wolf'). */
  review(r: { agentId: AgentId; taskId: string; callId: string; tool: string; risk: Risk }): StubVerdict {
    const deny = r.risk === 'external';
    const verdict: StubVerdict = deny ? 'deny' : r.risk === 'write' || r.risk === 'destructive' ? 'ask' : 'allow';
    this.bus.emit({
      type: 'wolf.verdict',
      agentId: 'wolf',
      taskId: r.taskId,
      callId: r.callId,
      verdict,
      rule: deny ? 'W1' : verdict === 'ask' ? 'W3' : 'W2',
      reason: deny ? 'ADE never sends or posts for you.' : verdict === 'ask' ? `${r.tool} requires your approval.` : `${r.tool} is ${r.risk}-only, so it is allowed.`,
    });
    return verdict;
  }
}
