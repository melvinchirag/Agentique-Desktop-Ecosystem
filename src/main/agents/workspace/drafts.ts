import type { GmailApi, GmailThread } from '../../connectors/google/api';
import type { Clock, DraftRecord, DraftsLog, NudgeEngine, NudgeStore } from '../../runtime/types';

/** The registry owns persistence and serialization; draft rows contain metadata only. */
export interface DraftRegistryRow {
  kind: 'draft';
  id: string;
  threadId?: string;
  messageId?: string;
  createdAt: number;
  toCount?: number;
  subject?: string;
  state: DraftRecord['state'];
}

export interface DraftRegistry {
  recordDraft(row: Omit<DraftRegistryRow, 'kind' | 'state'>): Promise<void>;
  setDraftState(id: string, state: 'sent' | 'deleted'): Promise<void>;
  drafts(): Promise<DraftRegistryRow[]>;
}

/** Local registry-backed primary log. */
export class LocalDraftsLog implements DraftsLog {
  constructor(private readonly registry: DraftRegistry, private readonly clock?: Clock) {}

  async record(draft: Omit<DraftRecord, 'state'>): Promise<void> {
    await this.registry.recordDraft({
      id: draft.gmailDraftId,
      createdAt: draft.ts,
      toCount: draft.toCount,
      subject: draft.subject.slice(0, 120),
    });
  }

  async setState(gmailDraftId: string, state: 'sent' | 'deleted'): Promise<void> {
    await this.registry.setDraftState(gmailDraftId, state);
  }

  async waiting(olderThanMs: number): Promise<DraftRecord[]> {
    const cutoff = (this.clock?.now() ?? Date.now()) - olderThanMs;
    return (await this.registry.drafts())
      .filter((row) => row.state === 'waiting' && row.createdAt <= cutoff)
      .map((row) => ({
        gmailDraftId: row.id,
        ts: row.createdAt,
        toCount: row.toCount ?? 0,
        subject: (row.subject ?? '').slice(0, 120),
        state: 'waiting' as const,
      }));
  }
}

/** Local-first mirror. Tiger writes are best effort; reads use Tiger only if local has none. */
export class CompositeDraftsLog implements DraftsLog {
  constructor(private readonly local: DraftsLog, private readonly tiger?: DraftsLog) {}

  async record(draft: Omit<DraftRecord, 'state'>): Promise<void> {
    await this.local.record(draft);
    if (this.tiger) void this.tiger.record(draft).catch(() => undefined);
  }

  async setState(id: string, state: 'sent' | 'deleted'): Promise<void> {
    await this.local.setState(id, state);
    if (this.tiger) void this.tiger.setState(id, state).catch(() => undefined);
  }

  async waiting(olderThanMs: number): Promise<DraftRecord[]> {
    const local = await this.local.waiting(olderThanMs);
    if (local.length || !this.tiger) return local;
    return this.tiger.waiting(olderThanMs);
  }
}

const THREE_HOURS = 3 * 60 * 60_000;
const SIX_HOURS = 6 * 60 * 60_000;
const THIRTY_MINUTES = 30 * 60_000;
const TEN_MINUTES = 10 * 60_000;

function eventBlock(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `drafts-waiting:${year}-${month}-${day}:${Math.floor(now.getHours() / 6)}`;
}

/** Schedules one metadata-only reminder per six-hour block; Chip owns quiet hours. */
export class DraftsWaitingRule {
  private timer: unknown;
  private started = false;
  private disposed = false;
  private checking = false;

  constructor(
    private readonly drafts: DraftsLog,
    private readonly nudges: NudgeEngine,
    private readonly nudgeStore: NudgeStore,
    private readonly clock: Clock,
  ) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    void this.check();
    this.arm();
  }

  async check(): Promise<void> {
    if (this.disposed || this.checking) return;
    this.checking = true;
    try {
      const waiting = await this.drafts.waiting(THREE_HOURS);
      if (!waiting.length || this.disposed) return;
      const now = new Date(this.clock.now());
      const key = eventBlock(now);
      const previousKey = eventBlock(new Date(now.getTime() - SIX_HOURS));
      if (await this.nudgeStore.findByEvent(key, 'custom')) return;
      if (previousKey !== key && await this.nudgeStore.findByEvent(previousKey, 'custom')) return;
      this.nudges.schedule({
        kind: 'custom',
        source: 'rule',
        eventId: key,
        about: 'drafts waiting',
        question: `You have ${waiting.length} draft${waiting.length === 1 ? '' : 's'} waiting in Gmail. Want me to read them back?`,
        askAt: now,
      });
    } finally {
      this.checking = false;
    }
  }

  stop(): void {
    this.disposed = true;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    if (this.disposed) return;
    this.timer = this.clock.setTimeout(() => {
      void this.check();
      this.arm();
    }, THIRTY_MINUTES);
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown; response?: { status?: unknown } };
  return e.status === 404 || e.statusCode === 404 || e.response?.status === 404 || e.code === 404 || e.code === '404';
}

function hasLaterSentMessage(thread: GmailThread, createdAt: number): boolean {
  return thread.messages.some((message) =>
    message.labels.includes('SENT') && message.internalDate > createdAt,
  );
}

/** Polls Gmail without affecting Pixel presence; transient failures preserve waiting state. */
export class DraftTracker {
  private timer: unknown;
  private running = false;
  private disposed = false;

  constructor(
    private readonly gmail: GmailApi,
    private readonly registry: DraftRegistry,
    private readonly drafts: DraftsLog,
    private readonly clock: Clock,
  ) {}

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    void this.check();
  }

  async check(): Promise<void> {
    if (this.disposed) return;
    const rows = (await this.registry.drafts()).filter((row) => row.state === 'waiting');
    for (const row of rows) {
      if (this.disposed) return;
      try {
        await this.gmail.getDraft(row.id);
      } catch (error) {
        if (!isNotFound(error)) continue;
        let state: 'sent' | 'deleted' = 'deleted';
        if (row.threadId) {
          try {
            if (hasLaterSentMessage(await this.gmail.getThread(row.threadId), row.createdAt)) state = 'sent';
          } catch {
            continue;
          }
        }
        await this.drafts.setState(row.id, state);
      }
    }
    if (rows.length) this.arm();
  }

  stop(): void {
    this.disposed = true;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      void this.check();
    }, TEN_MINUTES);
  }
}
