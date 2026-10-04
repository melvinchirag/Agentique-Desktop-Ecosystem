import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/main/store/tiger';
import { pixelToday, safeSubject, TigerDraftsLog } from '../src/main/store/tigerDrafts';
import { TigerQueries } from '../src/main/store/tigerQueries';
import { splitStatements } from '../scripts/tiger-migrate';

class FakeDb implements Db {
  calls: { text: string; params: any[] }[] = [];
  down = false;
  reply: (text: string) => any[] = () => [];
  async query(text: string, params: any[] = []) {
    if (this.down) throw new Error('connect ECONNREFUSED postgres://user:secret@host/db');
    this.calls.push({ text, params });
    return { rows: this.reply(text) };
  }
}
const NOW = Date.UTC(2026, 9, 4, 12);
const quiet = () => {};
const log = (db: FakeDb, logs: string[] = []) => new TigerDraftsLog(db, () => NOW, (m) => logs.push(m));

describe('TigerDraftsLog.record', () => {
  it('upserts on the Gmail draft id and stores metadata only', async () => {
    const db = new FakeDb();
    await log(db).record({ gmailDraftId: 'r-123', ts: NOW, toCount: 2, subject: 'Re: CS 280 review session' });
    const { text, params } = db.calls[0]!;
    expect(text).toMatch(/INSERT INTO drafts_log \(id, ts, gmail_draft_id, to_count, subject, state\)/);
    expect(text).toMatch(/ON CONFLICT \(gmail_draft_id\) DO UPDATE SET ts = EXCLUDED\.ts, to_count = EXCLUDED\.to_count, subject = EXCLUDED\.subject/);
    expect(text).not.toMatch(/DO UPDATE SET[^;]*state/);                 // re-recording keeps the state
    expect(params.slice(1)).toEqual([new Date(NOW), 'r-123', 2, 'Re: CS 280 review session']);
    expect(params[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('cuts the subject to 120 characters', async () => {
    const db = new FakeDb();
    await log(db).record({ gmailDraftId: 'r-1', ts: NOW, toCount: 1, subject: 'a'.repeat(150) });
    expect(db.calls[0]!.params[4]).toHaveLength(120);
  });

  it('drops a row whose subject is over 200 characters or has line breaks (it looks like a body)', async () => {
    const db = new FakeDb();
    const logs: string[] = [];
    await log(db, logs).record({ gmailDraftId: 'r-1', ts: NOW, toCount: 1, subject: 'x'.repeat(201) });
    await log(db, logs).record({ gmailDraftId: 'r-2', ts: NOW, toCount: 1, subject: 'Hi Prof,\nI will be there.\nThanks' });
    expect(db.calls).toHaveLength(0);
    expect(logs).toHaveLength(2);
    expect(logs.join(' ')).not.toMatch(/Prof|be there/);                 // the log never repeats the text
  });

  it('a bad recipient count becomes 0', async () => {
    const db = new FakeDb();
    await log(db).record({ gmailDraftId: 'r-1', ts: NOW, toCount: NaN, subject: 's' });
    expect(db.calls[0]!.params[3]).toBe(0);
  });

  it('safeSubject', () => {
    expect(safeSubject('  Hello  ')).toBe('Hello');
    expect(safeSubject('a\nb')).toBeNull();
    expect(safeSubject('y'.repeat(200))).toHaveLength(120);
  });
});

describe('TigerDraftsLog state and waiting', () => {
  it('setState updates by Gmail draft id and ignores other states', async () => {
    const db = new FakeDb();
    await log(db).setState('r-1', 'sent');
    await log(db).setState('r-1', 'waiting' as any);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ text: 'UPDATE drafts_log SET state = $2 WHERE gmail_draft_id = $1', params: ['r-1', 'sent'] });
  });

  it('waiting uses a cutoff and maps rows to DraftRecord', async () => {
    const db = new FakeDb();
    db.reply = () => [{ gmail_draft_id: 'r-1', ts: new Date(NOW - 4 * 3600_000), to_count: 3, subject: 'Hello', state: 'waiting' }];
    const rows = await log(db).waiting(3 * 3600_000);
    expect(db.calls[0]!.text).toMatch(/state = 'waiting' AND ts <= \$1 ORDER BY ts/);
    expect(db.calls[0]!.params).toEqual([new Date(NOW - 3 * 3600_000)]);
    expect(rows).toEqual([{ gmailDraftId: 'r-1', ts: NOW - 4 * 3600_000, toCount: 3, subject: 'Hello', state: 'waiting' }]);
  });

  it('never throws when Tiger is down: writes are dropped, waiting returns []', async () => {
    const db = new FakeDb();
    db.down = true;
    const logs: string[] = [];
    const drafts = log(db, logs);
    await expect(drafts.record({ gmailDraftId: 'r-1', ts: NOW, toCount: 1, subject: 's' })).resolves.toBeUndefined();
    await expect(drafts.setState('r-1', 'deleted')).resolves.toBeUndefined();
    expect(await drafts.waiting(0)).toEqual([]);
    expect(logs).toHaveLength(3);
    expect(logs.join(' ')).not.toContain('secret');
  });
});

describe('pulse().pixel', () => {
  it('pixelToday reads drafts today and drafts waiting', async () => {
    const db = new FakeDb();
    db.reply = () => [{ drafts_today: 4, waiting: 2 }];
    expect(await pixelToday(db, quiet)).toEqual({ draftsToday: 4, waiting: 2 });
  });
  it('pulse() has a pixel key and survives an outage', async () => {
    const db = new FakeDb();
    db.reply = (text) => (text.includes('drafts_log') ? [{ drafts_today: 1, waiting: 1 }] : []);
    const pulse: any = await new TigerQueries(db, quiet).pulse();
    expect(pulse).toMatchObject({ moodWeek: [], jobsPerAgent: {}, wardenBlocks: 0, wardenAsks: 0 });
    expect(pulse.pixel).toEqual({ draftsToday: 1, waiting: 1 });
    db.down = true;
    expect(((await new TigerQueries(db, quiet).pulse()) as any).pixel).toEqual({ draftsToday: 0, waiting: 0 });
  });
});

describe('schema', () => {
  it('has the unique index the upsert needs', () => {
    const statements = splitStatements(readFileSync(join(__dirname, '..', 'scripts', 'tiger-schema.sql'), 'utf8'));
    expect(statements).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_drafts_gmail ON drafts_log (gmail_draft_id)');
  });
});
