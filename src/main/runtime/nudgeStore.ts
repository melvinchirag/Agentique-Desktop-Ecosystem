import type { Nudge, NudgeKind, NudgeStore } from './types';

function copy(n: Nudge): Nudge {
  return { ...n, askAt: new Date(n.askAt) };
}

/** In-memory NudgeStore. Tiger replaces it later (S5b). Copies in, copies out. */
export class MemoryNudgeStore implements NudgeStore {
  /** Every nudge ever inserted, in insertion order. For tests. */
  readonly all: Nudge[] = [];

  async insert(n: Nudge): Promise<void> {
    this.all.push(copy(n));
  }

  async update(id: string, patch: Partial<Nudge>): Promise<void> {
    const found = this.all.find((n) => n.id === id);
    if (!found) return;
    const { id: _ignored, ...rest } = patch;
    Object.assign(found, rest);
    if (rest.askAt) found.askAt = new Date(rest.askAt);
  }

  /** Pending or snoozed nudges whose time has come, oldest first. */
  async due(now: Date): Promise<Nudge[]> {
    return this.all
      .filter((n) => (n.state === 'pending' || n.state === 'snoozed') && n.askAt.getTime() <= now.getTime())
      .sort((a, b) => a.askAt.getTime() - b.askAt.getTime())
      .map(copy);
  }

  async findByEvent(eventId: string, kind: NudgeKind): Promise<Nudge | null> {
    const found = this.all.find((n) => n.eventId === eventId && n.kind === kind && n.state !== 'cancelled');
    return found ? copy(found) : null;
  }
}
