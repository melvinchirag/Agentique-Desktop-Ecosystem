import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { BiomeEvent } from '../src/shared/events';
import type { Nudge } from '../src/main/runtime/types';
import { TigerEventSink, fromRow, redact, tigerPoolConfig, toRow, type Db } from '../src/main/store/tiger';
import { TigerHistoryStore } from '../src/main/store/tigerHistory';
import { TigerNudgeStore } from '../src/main/store/tigerNudges';
import { TigerQueries } from '../src/main/store/tigerQueries';
import { splitStatements } from '../scripts/tiger-migrate';

class FakeDb implements Db {
  calls: { text: string; params: any[] }[] = [];
  down = false;
  rows: any[] = [];
  async query(text: string, params: any[] = []) {
    if (this.down) throw new Error('connect ECONNREFUSED postgres://user:secret@host:5432/tsdb');
    this.calls.push({ text, params });
    return { rows: this.rows };
  }
}
const SESSION = randomUUID();
const event = (over: Partial<BiomeEvent> & Record<string, unknown> = {}): BiomeEvent =>
  ({ id: randomUUID(), ts: 1_790_000_000_000, sessionId: SESSION, taskId: randomUUID(), agentId: 'chipmunk', type: 'user.message', text: 'hi', source: 'text', ...over }) as BiomeEvent;

const dirs: string[] = [];
const tmpFile = () => { const d = mkdtempSync(join(tmpdir(), 'ade-tiger-')); dirs.push(d); return join(d, 'pending-events.jsonl'); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const quiet = () => {};

describe('toRow / fromRow', () => {
  it('splits an event into columns and payload, and back', () => {
    const e = event();
    const row = toRow(e);
    if (typeof row === 'string') throw new Error(row);
    expect(row).toMatchObject({ id: e.id, session_id: SESSION, task_id: e.taskId, agent_id: 'chipmunk', type: 'user.message', payload: { text: 'hi', source: 'text' } });
    expect(row.payload).not.toHaveProperty('id');
    expect(fromRow({ ...row, ts: new Date(row.ts) })).toEqual(e);
  });

  it('an event without a task has a null task_id', () => {
    const row = toRow(event({ taskId: undefined }));
    expect(typeof row !== 'string' && row.task_id).toBeNull();
  });

  it('a non-UUID task id is kept in the payload instead of breaking the insert', () => {
    const e = event({ taskId: 'task-7' });
    const row = toRow(e);
    if (typeof row === 'string') throw new Error(row);
    expect(row.task_id).toBeNull();
    expect(row.payload._taskId).toBe('task-7');
    expect(fromRow({ ...row, ts: row.ts }).taskId).toBe('task-7');
  });

  it('rejects a payload over 4 KB (privacy: no email bodies or file text)', () => {
    expect(toRow(event({ text: 'x'.repeat(5000) }))).toMatch(/4096/);
  });

  it('rejects an event whose id is not a UUID', () => {
    expect(toRow(event({ id: 'nope' }))).toMatch(/UUID/);
  });
});

describe('TigerEventSink', () => {
  it('batches buffered events into one insert', async () => {
    const db = new FakeDb();
    const sink = new TigerEventSink({ db, pendingFile: tmpFile(), log: quiet });
    for (let i = 0; i < 3; i++) sink.enqueue(event());
    await sink.dispose();
    expect(db.calls).toHaveLength(1);
    expect(JSON.parse(db.calls[0]!.params[0])).toHaveLength(3);
  });

  it('events in the same millisecond get increasing timestamps, so Replay keeps their order', async () => {
    const db = new FakeDb();
    const sink = new TigerEventSink({ db, pendingFile: tmpFile(), log: quiet });
    for (let i = 0; i < 3; i++) sink.enqueue(event({ ts: 1_790_000_000_000 }));
    sink.enqueue(event({ ts: 1_790_000_000_005 }));
    await sink.dispose();
    const stamps = JSON.parse(db.calls[0]!.params[0]).map((r: any) => r.ts);
    expect(stamps).toEqual(['2026-09-21T14:13:20.000000Z', '2026-09-21T14:13:20.000001Z', '2026-09-21T14:13:20.000002Z', '2026-09-21T14:13:20.005000Z']);
    expect(stamps.map((t: string) => new Date(t).getTime())).toEqual([1_790_000_000_000, 1_790_000_000_000, 1_790_000_000_000, 1_790_000_000_005]);
  });

  it('never sends more than maxBatch rows per insert', async () => {
    const db = new FakeDb();
    const sink = new TigerEventSink({ db, pendingFile: tmpFile(), maxBatch: 200, log: quiet });
    for (let i = 0; i < 450; i++) sink.enqueue(event());
    await sink.dispose();
    expect(db.calls.map((c) => JSON.parse(c.params[0]).length)).toEqual([200, 200, 50]);
  });

  it('drops oversized events and keeps the rest', async () => {
    const db = new FakeDb();
    const logs: string[] = [];
    const sink = new TigerEventSink({ db, pendingFile: tmpFile(), log: (m) => logs.push(m) });
    sink.enqueue(event({ text: 'x'.repeat(5000) }));
    sink.enqueue(event());
    await sink.dispose();
    expect(JSON.parse(db.calls[0]!.params[0])).toHaveLength(1);
    expect(logs[0]).toMatch(/dropped/);
  });

  it('a Tiger outage saves rows to the jsonl file without throwing, and never logs the connection string', async () => {
    const db = new FakeDb();
    db.down = true;
    const file = tmpFile();
    const logs: string[] = [];
    const sink = new TigerEventSink({ db, pendingFile: file, log: (m) => logs.push(m) });
    sink.enqueue(event());
    sink.enqueue(event());
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(logs.join(' ')).not.toContain('secret');
    await sink.dispose();
  });

  it('retries the backlog when Tiger is back, then removes the file', async () => {
    const db = new FakeDb();
    db.down = true;
    const file = tmpFile();
    const sink = new TigerEventSink({ db, pendingFile: file, log: quiet });
    sink.enqueue(event());
    await sink.flush();
    await sink.retryPending();
    expect(existsSync(file)).toBe(true);                    // still down: file kept
    db.down = false;
    await sink.retryPending();
    expect(existsSync(file)).toBe(false);
    expect(JSON.parse(db.calls[0]!.params[0])).toHaveLength(1);
    await sink.dispose();
  });

  it('attach() stores every bus event', async () => {
    const db = new FakeDb();
    const sink = new TigerEventSink({ db, pendingFile: tmpFile(), log: quiet });
    let subscriber: (e: BiomeEvent) => void = () => {};
    const off = sink.attach({ sessionId: SESSION, emit: () => event(), recent: () => [], subscribe: (cb) => { subscriber = cb; return () => {}; } });
    subscriber(event());
    await sink.dispose();
    expect(typeof off).toBe('function');
    expect(db.calls).toHaveLength(1);
  });
});

describe('TigerHistoryStore', () => {
  const NOW = Date.UTC(2026, 9, 4, 12);
  it.each(['recent_tasks', 'warden_blocks', 'agent_activity', 'mood_history'] as const)('%s passes a cutoff date and the agent filter', async (kind) => {
    const db = new FakeDb();
    db.rows = [{ at: new Date(NOW), n: 1 }];
    const rows = await new TigerHistoryStore(db, () => NOW, quiet).query(kind, 24, 'beaver');
    expect(db.calls[0]!.params).toEqual([new Date(NOW - 24 * 3600 * 1000), 'beaver']);
    expect(db.calls[0]!.text).toMatch(/LIMIT 20/);
    expect(rows).toEqual([{ at: new Date(NOW).toISOString(), n: 1 }]);
  });

  it('no agent → null filter; bad hours → 24', async () => {
    const db = new FakeDb();
    await new TigerHistoryStore(db, () => NOW, quiet).query('recent_tasks', NaN);
    expect(db.calls[0]!.params).toEqual([new Date(NOW - 24 * 3600 * 1000), null]);
  });

  it('returns [] when Tiger is unreachable', async () => {
    const db = new FakeDb();
    db.down = true;
    expect(await new TigerHistoryStore(db, () => NOW, quiet).query('mood_history', 24)).toEqual([]);
  });
});

describe('TigerNudgeStore', () => {
  const nudge = (over: Partial<Nudge> = {}): Nudge =>
    ({ id: randomUUID(), kind: 'after', about: 'CS 280 midterm', question: "How'd it go?", askAt: new Date('2026-10-05T18:00:00Z'), state: 'pending', source: 'chip', ...over });

  it('insert writes every column; an event nudge upserts on (event_id, kind)', async () => {
    const db = new FakeDb();
    const store = new TigerNudgeStore(db, quiet);
    const n = nudge({ eventId: 'cal-1' });
    await store.insert(n);
    expect(db.calls[0]!.params).toEqual([n.id, 'after', 'CS 280 midterm', "How'd it go?", n.askAt, 'pending', 'chip', 'cal-1']);
    expect(db.calls[0]!.text).toMatch(/ON CONFLICT \(event_id, kind\)/);
    await store.insert(nudge());
    expect(db.calls[1]!.text).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it('update maps camelCase fields to columns and never changes the id', async () => {
    const db = new FakeDb();
    const store = new TigerNudgeStore(db, quiet);
    const later = new Date('2026-10-05T20:00:00Z');
    await store.update('n1', { id: 'other', state: 'snoozed', askAt: later });
    expect(db.calls[0]!.text).toMatch(/UPDATE nudges SET state = \$2, ask_at = \$3 WHERE id = \$1/);
    expect(db.calls[0]!.params).toEqual(['n1', 'snoozed', later]);
  });

  it('due reads pending and snoozed nudges and maps rows back', async () => {
    const db = new FakeDb();
    db.rows = [{ id: 'n1', kind: 'after', about: 'a', question: 'q', ask_at: '2026-10-05T18:00:00Z', state: 'pending', source: 'chip', event_id: null }];
    const due = await new TigerNudgeStore(db, quiet).due(new Date('2026-10-06T00:00:00Z'));
    expect(db.calls[0]!.text).toMatch(/state IN \('pending', 'snoozed'\) AND ask_at <= \$1/);
    expect(due).toEqual([{ id: 'n1', kind: 'after', about: 'a', question: 'q', askAt: new Date('2026-10-05T18:00:00Z'), state: 'pending', source: 'chip' }]);
  });

  it('keeps working from its local copy while Tiger is down', async () => {
    const db = new FakeDb();
    db.down = true;
    const store = new TigerNudgeStore(db, quiet);
    const a = nudge({ eventId: 'cal-1' });
    const b = nudge({ askAt: new Date('2026-10-09T00:00:00Z') });
    await store.insert(a);
    await store.insert(b);
    await store.update(a.id, { state: 'snoozed' });
    expect((await store.due(new Date('2026-10-06T00:00:00Z'))).map((n) => [n.id, n.state])).toEqual([[a.id, 'snoozed']]);
    expect((await store.findByEvent('cal-1', 'after'))?.id).toBe(a.id);
    await store.update(a.id, { state: 'cancelled' });
    expect(await store.findByEvent('cal-1', 'after')).toBeNull();
  });
});

describe('TigerQueries', () => {
  it('taskEvents rebuilds BiomeEvents in order', async () => {
    const db = new FakeDb();
    const e = event();
    const row = toRow(e);
    if (typeof row === 'string') throw new Error(row);
    db.rows = [{ ...row, ts: new Date(row.ts) }];
    expect(await new TigerQueries(db, quiet).taskEvents(e.taskId!)).toEqual([e]);
    expect(db.calls[0]!.text).toMatch(/WHERE task_id = \$1 ORDER BY ts/);
  });

  it('taskEvents with a non-UUID id returns [] without a query', async () => {
    const db = new FakeDb();
    expect(await new TigerQueries(db, quiet).taskEvents("x'; DROP TABLE biome_events")).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it('wardenAudit caps the limit', async () => {
    const db = new FakeDb();
    await new TigerQueries(db, quiet).wardenAudit(99999);
    expect(db.calls[0]!.params).toEqual([200]);
  });

  it('pulse returns mood, jobs, and activity; empty when Tiger is down', async () => {
    const db = new FakeDb();
    expect(Object.keys(await new TigerQueries(db, quiet).pulse())).toEqual(['mood', 'jobs', 'activity', 'warden']);
    db.down = true;
    expect(await new TigerQueries(db, quiet).pulse()).toEqual({ mood: [], jobs: [], activity: [], warden: { allowed: 0, asked: 0, denied: 0, alerts: 0 } });
  });
});

describe('connection config', () => {
  it('keeps certificate verification on and strips sslmode', () => {
    const cfg = tigerPoolConfig({ TIGER_DATABASE_URL: 'postgres://u:p@host:5432/tsdb?sslmode=require' });
    expect(cfg.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(cfg.connectionString).not.toContain('sslmode');
  });
  it('fails clearly without a URL, and redacts URLs in messages', () => {
    expect(() => tigerPoolConfig({})).toThrow(/TIGER_DATABASE_URL/);
    expect(redact('cannot reach postgres://u:p@host/db now')).toBe('cannot reach [database url] now');
  });
  it('the schema file splits into single statements', () => {
    const statements = splitStatements(readFileSync(join(__dirname, '..', 'scripts', 'tiger-schema.sql'), 'utf8'));
    expect(statements.length).toBeGreaterThan(25);
    expect(statements.every((s) => !s.includes(';\n'))).toBe(true);
    expect(statements.filter((s) => s.includes('materialized_only = false'))).toHaveLength(4);
  });
});
