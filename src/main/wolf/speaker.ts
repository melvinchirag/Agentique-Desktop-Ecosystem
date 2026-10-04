import type { BiomeEvent } from '../../shared/events';
import type { Bus, Clock } from '../runtime/types';
import { lineFor, type SelectedWardenLine, type WardenLineId } from './lines';

export interface WardenSpeakerDeps {
  bus: Bus;
  clock: Clock;
  /** Optional inspection metadata for a W6 verdict; never copied into speech. */
  countForCall?: (callId: string) => number | undefined;
  toolForCall?: (callId: string) => string | undefined;
}

/** Turns security events into fixed Warden speech. The gate remains independent of speech. */
export class WardenSpeaker {
  private readonly unsubscribe: () => void;
  private readonly lastSpoken = new Map<WardenLineId, number>();
  private readonly pendingTools = new Map<string, string>();
  private disposed = false;

  constructor(private readonly deps: WardenSpeakerDeps) {
    this.unsubscribe = deps.bus.subscribe((event) => this.handle(event));
  }

  greet(): void {
    this.speak(lineFor({ kind: 'greeting' }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.pendingTools.clear();
    this.lastSpoken.clear();
  }

  private handle(event: BiomeEvent): void {
    if (this.disposed) return;
    if (event.type === 'tool.request') {
      this.pendingTools.set(event.callId, event.tool);
      return;
    }
    if (event.type === 'wolf.verdict') {
      const tool = this.deps.toolForCall?.(event.callId) ?? this.pendingTools.get(event.callId);
      this.pendingTools.delete(event.callId);
      this.speak(lineFor({
        kind: 'decision', verdict: event.verdict, rule: event.rule, reason: event.reason,
        tool, count: this.deps.countForCall?.(event.callId),
      }), event.taskId);
      return;
    }
    if (event.type === 'approval.resolve') {
      this.speak(lineFor({ kind: 'outcome', approved: event.approved, how: event.how }), event.taskId);
      return;
    }
    if (event.type === 'wolf.alert') {
      this.speak(lineFor({ kind: 'alert', source: event.source, reason: event.reason }), event.taskId);
    }
  }

  private speak(selected: SelectedWardenLine | undefined, taskId?: string): void {
    if (!selected || this.disposed) return;
    const now = this.deps.clock.now();
    const last = this.lastSpoken.get(selected.id);
    if (last !== undefined && now - last < 10_000) return;
    this.lastSpoken.set(selected.id, now);
    const { text, bubble, priority } = selected.line;
    this.deps.bus.emit({ type: 'agent.say', agentId: 'wolf', taskId, text, bubble, priority });
  }
}

export function createWardenSpeaker(deps: WardenSpeakerDeps): WardenSpeaker {
  return new WardenSpeaker(deps);
}
