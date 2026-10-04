/** Temporary real-mode specialist seam. Replace this module with AgentRuntime and WardenGate. */
import { randomUUID } from 'node:crypto';
import type { ArtifactKind } from '../../shared/events';
import type { Bus, Clock, SpecialistId, SpecialistRunContext, SpecialistRunner, AgentResult } from '../runtime/types';

const SEND_OR_POST = /\b(send|post|publish)\s+(?:it|this|that|the\s+(?:email|message|post|draft)|now)\b/i;

const scenes: Record<SpecialistId, { detail: string; say: string; bubble: string; kind: ArtifactKind; title: string }> = {
  workspace: { detail: 'Reading 12 letters…', say: 'I prepared an inbox summary and a draft for you to review.', bubble: 'Draft ready', kind: 'email_digest', title: 'Inbox preview' },
  beaver: { detail: 'Sorting the file plan…', say: 'I prepared a file plan for you to review.', bubble: 'Plan ready', kind: 'file_plan', title: 'File plan preview' },
  eagle: { detail: 'Checking nearby sources…', say: 'I prepared a short research brief for you to review.', bubble: 'Brief ready', kind: 'research_brief', title: 'Research preview' },
  ants: { detail: 'Mapping the next steps…', say: 'I mapped out the next steps for you.', bubble: 'Plan ready', kind: 'day_plan', title: 'Day plan preview' },
  butterfly: { detail: 'Sketching a post…', say: 'I prepared a post draft for you to review.', bubble: 'Post ready', kind: 'social_post', title: 'Post preview' },
  nightingale: { detail: 'Finding a calm rhythm…', say: 'I prepared a calming note for you.', bubble: 'Note ready', kind: 'file_note', title: 'Calming note' },
};

function emitDenial(bus: Bus, agentId: SpecialistId | 'chipmunk', taskId: string, action: string): void {
  const callId = randomUUID();
  bus.emit({ type: 'tool.request', agentId, taskId, callId, tool: action === 'send' ? 'email_send' : 'social_post', args: {}, risk: 'external' });
  bus.emit({ type: 'wolf.verdict', agentId: 'wolf', taskId, callId, verdict: 'deny', rule: 'W1', reason: 'ADE never sends or posts for you.' });
  bus.emit({ type: 'agent.mood', agentId: 'wolf', taskId, mood: 'protective', intensity: 1, cause: 'user' });
  bus.emit({ type: 'agent.say', agentId: 'wolf', taskId, text: 'I stopped that. You can review the draft and send or post it yourself.', bubble: 'Blocked', priority: 'warden' });
  bus.emit({ type: 'tool.result', agentId, taskId, callId, ok: false, summary: 'Blocked by Warden.' });
}

/** Catch direct send/post requests while those tools are still stand-ins. */
export function handleStandInSendPost(bus: Bus, text: string, source: 'text' | 'voice' = 'text'): boolean {
  const action = SEND_OR_POST.exec(text)?.[1]?.toLowerCase();
  if (!action) return false;
  const taskId = randomUUID();
  bus.emit({ type: 'user.message', agentId: 'chipmunk', taskId, text, source });
  emitDenial(bus, 'chipmunk', taskId, action);
  bus.emit({ type: 'agent.say', agentId: 'chipmunk', taskId, text: 'Warden blocked that action. Your draft is still yours to send.', bubble: 'You’re safe', priority: 'chip' });
  bus.emit({ type: 'agent.status', agentId: 'chipmunk', taskId, status: 'idle' });
  return true;
}

function delay(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const onAbort = (): void => { clock.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = clock.setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class StandInSpecialists implements SpecialistRunner {
  private bus: Bus | undefined;
  constructor(private readonly clock: Clock) {}
  connect(bus: Bus): void { this.bus = bus; }

  async run(agentId: SpecialistId, task: string, ctx: SpecialistRunContext): Promise<AgentResult> {
    const bus = this.bus;
    if (!bus) throw new Error('Stand-in specialists are not connected to the event bus.');
    const action = SEND_OR_POST.exec(task)?.[1]?.toLowerCase();
    if (action) {
      emitDenial(bus, agentId, ctx.taskId, action);
      return { ok: false, say: 'Warden blocked the send or post. Nothing was sent.', bubble: 'Blocked', summary: 'Send or post blocked by Warden.', artifacts: [] };
    }
    const scene = scenes[agentId];
    bus.emit({ type: 'agent.status', agentId, taskId: ctx.taskId, status: agentId === 'eagle' ? 'away' : 'working', detail: scene.detail });
    await delay(this.clock, agentId === 'workspace' || agentId === 'beaver' ? 4200 : 2500, ctx.signal);
    if (ctx.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    bus.emit({ type: 'artifact', agentId, taskId: ctx.taskId, kind: scene.kind, title: scene.title, data: { preview: true, task } });
    bus.emit({ type: 'agent.status', agentId, taskId: ctx.taskId, status: agentId === 'eagle' ? 'idle' : 'done' });
    return { ok: true, say: scene.say, bubble: scene.bubble, summary: `${scene.title} is ready to review.`, artifacts: [{ kind: scene.kind, title: scene.title }] };
  }
}
