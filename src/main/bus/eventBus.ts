import { randomUUID } from 'node:crypto';
import type { BiomeEvent } from '../../shared/events';
import type { BiomeEventInput, Bus, Clock } from '../runtime/types';

export interface EventBusOptions {
  sessionId?: string;
  clock?: Pick<Clock, 'now'>;
  ringSize?: number;                                      // default 500
  onSubscriberError?: (err: unknown, e: BiomeEvent) => void;
}

/** Every visible thing in the biome is caused by an event that passes through here. */
export class EventBus implements Bus {
  readonly sessionId: string;
  private readonly subscribers = new Set<(e: BiomeEvent) => void>();
  private readonly ring: BiomeEvent[] = [];
  private readonly ringSize: number;
  private readonly now: () => number;
  private readonly onSubscriberError: (err: unknown, e: BiomeEvent) => void;

  constructor(opts: EventBusOptions = {}) {
    this.sessionId = opts.sessionId ?? randomUUID();
    this.ringSize = opts.ringSize ?? 500;
    this.now = opts.clock ? () => opts.clock!.now() : () => Date.now();
    this.onSubscriberError = opts.onSubscriberError ?? ((err, e) => console.error(`[bus] subscriber failed on ${e.type}`, err));
  }

  emit(input: BiomeEventInput): BiomeEvent {
    const event = { ...input, id: randomUUID(), ts: this.now(), sessionId: this.sessionId } as BiomeEvent;
    this.ring.push(event);
    if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);
    // Snapshot so subscribe/unsubscribe during fan-out doesn't affect this event.
    for (const cb of [...this.subscribers]) {
      try {
        cb(event);
      } catch (err) {
        this.onSubscriberError(err, event);
      }
    }
    return event;
  }

  subscribe(cb: (e: BiomeEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  recent(limit?: number): BiomeEvent[] {
    return limit === undefined ? [...this.ring] : this.ring.slice(-limit);
  }
}
