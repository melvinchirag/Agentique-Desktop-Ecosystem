import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/main/store/tiger';
import { TigerHistoryStore } from '../src/main/store/tigerHistory';
import { TigerQueries } from '../src/main/store/tigerQueries';
import { wardenToday } from '../src/main/store/tigerWarden';
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
const quiet = () => {};

describe('wardenToday', () => {
  it('maps verdicts to the four inspect-card numbers', async () => {
    const db = new FakeDb();
    db.reply = () => [{ verdict: 'allow', times: 12 }, { verdict: 'ask', times: 3 }, { verdict: 'deny', times: 2 }, { verdict: 'alert', times: 1 }];
    expect(await wardenToday(db, quiet)).toEqual({ allowed: 12, asked: 3, denied: 2, alerts: 1 });
    expect(db.calls[0]!.text).toMatch(/FROM warden_daily WHERE day >= date_trunc\('day', now\(\)\)/);
  });
  it('missing verdicts are zero; unknown verdicts are ignored', async () => {
    const db = new FakeDb();
    db.reply = () => [{ verdict: 'deny', times: '4' }, { verdict: 'weird', times: 9 }];
    expect(await wardenToday(db, quiet)).toEqual({ allowed: 0, asked: 0, denied: 4, alerts: 0 });
  });
  it('returns zeros, never throws, and never logs the connection string when Tiger is down', async () => {
    const db = new FakeDb();
    db.down = true;
    const logs: string[] = [];
    expect(await wardenToday(db, (m) => logs.push(m))).toEqual({ allowed: 0, asked: 0, denied: 0, alerts: 0 });
    expect(logs.join(' ')).not.toContain('secret');
  });
});

describe('TigerQueries for Warden', () => {
  it('wardenAudit asks for the appended columns', async () => {
    const db = new FakeDb();
    await new TigerQueries(db, quiet).wardenAudit(10);
    expect(db.calls[0]!.text).toMatch(/approved, asking_agent, tool, how FROM wolf_audit ORDER BY ts DESC LIMIT \$1/);
    expect(db.calls[0]!.params).toEqual([10]);
  });
  it('pulse() gains warden counts and keeps its other keys', async () => {
    const db = new FakeDb();
    db.reply = (text) => (text.includes('warden_daily') ? [{ verdict: 'deny', times: 2 }] : []);
    const pulse: any = await new TigerQueries(db, quiet).pulse();
    expect(Object.keys(pulse)).toEqual(['mood', 'jobs', 'activity', 'warden']);
    expect(pulse.warden).toEqual({ allowed: 0, asked: 0, denied: 2, alerts: 0 });
  });
  it('pulse() still answers when Tiger is down', async () => {
    const db = new FakeDb();
    db.down = true;
    expect(await new TigerQueries(db, quiet).pulse()).toEqual({ mood: [], jobs: [], activity: [], warden: { allowed: 0, asked: 0, denied: 0, alerts: 0 } });
  });
});

describe('warden_blocks history', () => {
  it('reads rule and reason from the view columns and filters by the asking animal', async () => {
    const db = new FakeDb();
    db.reply = () => [{ at: new Date('2026-10-04T12:00:00Z'), agent: 'beaver', tool: 'fs_trash', rule: 'W4', reason: 'destructive' }];
    const rows = await new TigerHistoryStore(db, () => Date.UTC(2026, 9, 4, 13), quiet).query('warden_blocks', 24, 'beaver');
    expect(db.calls[0]!.text).toMatch(/SELECT ts AS at, asking_agent AS agent, tool, rule, reason\s+FROM wolf_audit/);
    expect(db.calls[0]!.text).not.toMatch(/payload/);
    expect(db.calls[0]!.params[1]).toBe('beaver');
    expect(rows).toEqual([{ at: '2026-10-04T12:00:00.000Z', agent: 'beaver', tool: 'fs_trash', rule: 'W4', reason: 'destructive' }]);
  });
});

describe('schema', () => {
  const statements = splitStatements(readFileSync(join(__dirname, '..', 'scripts', 'tiger-schema.sql'), 'utf8'));
  it('defines wolf_audit once, original columns first, new ones appended', () => {
    const views = statements.filter((s) => /CREATE OR REPLACE VIEW wolf_audit/.test(s));
    expect(views).toHaveLength(1);
    const columns = views[0]!.replace(/\s+/g, ' ');
    expect(columns).toMatch(/e\.ts, e\.task_id, e\.agent_id, e\.type, .*AS call_id, .*AS verdict, .*AS rule, .*AS reason, .*AS approved, r\.agent_id AS asking_agent, r\.tool AS tool, .*AS how FROM/);
  });
  it('has the warden_daily aggregate, real-time, with a refresh policy', () => {
    expect(statements.some((s) => /CREATE MATERIALIZED VIEW IF NOT EXISTS warden_daily/.test(s))).toBe(true);
    expect(statements.some((s) => /ALTER MATERIALIZED VIEW warden_daily SET \(timescaledb\.materialized_only = false\)/.test(s))).toBe(true);
    expect(statements.some((s) => /add_continuous_aggregate_policy\('warden_daily'/.test(s))).toBe(true);
  });
});
