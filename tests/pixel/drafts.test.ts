import { describe, expect, it } from 'vitest';
import type { GmailApi, GmailDraft, GmailMessage, GmailMessageSummary, GmailThread } from '../../src/main/connectors/google/api';
import { DraftsWaitingRule, DraftTracker, LocalDraftsLog, type DraftRegistry, type DraftRegistryRow } from '../../src/main/agents/workspace/drafts';
import { FakeClock, flushPromises } from '../../src/main/runtime/clock';
import { MemoryNudgeStore } from '../../src/main/runtime/nudgeStore';
import type { Nudge, NudgeEngine } from '../../src/main/runtime/types';

class MemoryRegistry implements DraftRegistry {
  rows: DraftRegistryRow[] = [];

  async recordDraft(row: Omit<DraftRegistryRow, 'kind' | 'state'>): Promise<void> {
    this.rows.push({ ...row, kind: 'draft', state: 'waiting' });
  }

  async setDraftState(id: string, state: 'sent' | 'deleted'): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (row) row.state = state;
  }

  async drafts(): Promise<DraftRegistryRow[]> {
    return this.rows.map((row) => ({ ...row }));
  }
}

/** Gmail behavior fake for the Pixel draft lane; never performs network calls. */
class FakeGoogle implements GmailApi {
  readonly draftErrors = new Map<string, unknown>();
  readonly threads = new Map<string, GmailThread>();
  getDraftCalls: string[] = [];

  async getDraft(id: string): Promise<GmailDraft> {
    this.getDraftCalls.push(id);
    const error = this.draftErrors.get(id);
    if (error) throw error;
    return { id, messageId: `message-${id}` };
  }
  async getThread(id: string): Promise<GmailThread> { return this.threads.get(id) ?? { id, messages: [] }; }
  async search(): Promise<GmailMessageSummary[]> { throw new Error('unused'); }
  async getMessage(): Promise<GmailMessage> { throw new Error('unused'); }
  async getAttachment(): Promise<Uint8Array> { throw new Error('unused'); }
  async listSent(): Promise<GmailMessageSummary[]> { throw new Error('unused'); }
  async createDraft(): Promise<GmailDraft> { throw new Error('unused'); }
  async updateDraft(): Promise<GmailDraft> { throw new Error('unused'); }
  async listDrafts(): Promise<GmailDraft[]> { throw new Error('unused'); }
}

class TestNudges implements NudgeEngine {
  readonly scheduled: Nudge[] = [];
  private id = 0;
  constructor(private readonly store: MemoryNudgeStore) {}
  schedule(nudge: Omit<Nudge, 'id' | 'state'>): string {
    const full: Nudge = { ...nudge, id: `n${++this.id}`, state: 'pending' };
    this.scheduled.push(full);
    void this.store.insert(full);
    return full.id;
  }
  start(): void {}
  cancel(): void {}
  snooze(): void {}
  markAnswered(): void {}
  fireNextNow(): void {}
  onDue(): void {}
  dispose(): void {}
}

const notFound = Object.assign(new Error('not found'), { status: 404 });

describe('Pixel drafts lifecycle and waiting nudges', () => {
  it('P28: schedules after three hours and deduplicates across rule restarts', async () => {
    const clock = new FakeClock(new Date(2026, 9, 4, 16, 0, 0));
    const registry = new MemoryRegistry();
    const log = new LocalDraftsLog(registry, clock);
    await log.record({ gmailDraftId: 'd1', ts: clock.now() - 3 * 60 * 60_000, toCount: 1, subject: 'private subject' });
    const store = new MemoryNudgeStore();
    const engine = new TestNudges(store);
    const first = new DraftsWaitingRule(log, engine, store, clock);
    await first.check();
    expect(engine.scheduled).toHaveLength(1);
    expect(engine.scheduled[0]).toMatchObject({ kind: 'custom', source: 'rule', eventId: 'drafts-waiting:2026-10-04:2' });
    expect(engine.scheduled[0]?.question).toContain('1 draft waiting');
    expect(engine.scheduled[0]?.question).not.toContain('private subject');

    const restartedEngine = new TestNudges(store);
    await new DraftsWaitingRule(log, restartedEngine, store, clock).check();
    expect(restartedEngine.scheduled).toHaveLength(0);

    await log.setState('d1', 'sent');
    clock.advance(7 * 60 * 60_000);
    const afterSendEngine = new TestNudges(new MemoryNudgeStore());
    await new DraftsWaitingRule(log, afterSendEngine, new MemoryNudgeStore(), clock).check();
    expect(afterSendEngine.scheduled).toHaveLength(0);
  });

  it('P29: marks 404 drafts sent only when a later SENT message exists, otherwise deleted', async () => {
    const clock = new FakeClock();
    const registry = new MemoryRegistry();
    const log = new LocalDraftsLog(registry, clock);
    await log.record({ gmailDraftId: 'sent', ts: clock.now() - 1000, toCount: 1, subject: 's' });
    await log.record({ gmailDraftId: 'deleted', ts: clock.now() - 1000, toCount: 1, subject: 'd' });
    await log.record({ gmailDraftId: 'offline', ts: clock.now() - 1000, toCount: 1, subject: 'o' });
    registry.rows[0]!.threadId = 'thread-sent';
    registry.rows[1]!.threadId = 'thread-deleted';
    registry.rows[2]!.threadId = 'thread-offline';

    const google = new FakeGoogle();
    google.draftErrors.set('sent', notFound);
    google.draftErrors.set('deleted', notFound);
    google.draftErrors.set('offline', new Error('network down'));
    google.threads.set('thread-sent', {
      id: 'thread-sent',
      messages: [{ id: 'm', threadId: 'thread-sent', snippet: '', labels: ['SENT'], internalDate: clock.now(), from: '', subject: '', headers: {}, textBody: '', attachments: [] }],
    });

    const tracker = new DraftTracker(google, registry, log, clock);
    await tracker.check();
    await flushPromises();
    const rows = await registry.drafts();
    expect(rows.map(({ id, state }) => [id, state])).toEqual([
      ['sent', 'sent'], ['deleted', 'deleted'], ['offline', 'waiting'],
    ]);
    expect(google.getDraftCalls).toEqual(['sent', 'deleted', 'offline']);
    tracker.stop();
  });
});
