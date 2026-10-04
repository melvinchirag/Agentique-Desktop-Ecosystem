import { describe, expect, it } from 'vitest';
import type { Db } from '../src/main/store/tiger';
import { localDay, TigerPlanStore, type PlanStore } from '../src/main/store/tigerPlans';

class FakeDb implements Db {
  calls: { text: string; params: any[] }[] = [];
  down = false;
  rows: any[] = [];
  async query(text: string, params: any[] = []) {
    if (this.down) throw new Error('connect ECONNREFUSED postgres://user:secret@host/db');
    this.calls.push({ text, params });
    return { rows: this.rows };
  }
}
const NOW = new Date(2026, 9, 4, 20, 0, 0).getTime();      // 8 PM local, Oct 4
const quiet = () => {};
const store = (db: FakeDb, logs: string[] = []): TigerPlanStore => new TigerPlanStore(db, () => NOW, (m) => logs.push(m));

describe('TigerPlanStore.savePlan', () => {
  it('saves one row per step, numbered from 1, for the local day', async () => {
    const db = new FakeDb();
    const start = new Date(2026, 9, 4, 9);
    const saved = await store(db).savePlan('Turn my notes into a report', ['Read the notes', { title: 'Find three sources', startAt: start }, 'Write the doc']);
    expect(saved.map((s) => [s.stepNo, s.title, s.status])).toEqual([[1, 'Read the notes', 'planned'], [2, 'Find three sources', 'planned'], [3, 'Write the doc', 'planned']]);
    expect(new Set(saved.map((s) => s.planId)).size).toBe(1);
    expect(saved.every((s) => s.planDate === '2026-10-04' && s.goal === 'Turn my notes into a report')).toBe(true);
    expect(db.calls).toHaveLength(3);
    expect(db.calls[0]!.text).toMatch(/INSERT INTO plan_items \(id, plan_id, goal, step_no, plan_date, title, start_at, end_at, status\)/);
    expect(db.calls[1]!.params).toEqual([saved[1]!.id, saved[1]!.planId, 'Turn my notes into a report', 2, '2026-10-04', 'Find three sources', start, null]);
  });

  it('localDay uses the local calendar day, not UTC', () => {
    expect(localDay(new Date(2026, 9, 4, 23, 30).getTime())).toBe('2026-10-04');
    expect(localDay(new Date(2026, 0, 5, 0, 5).getTime())).toBe('2026-01-05');
  });
});

describe('TigerPlanStore reads', () => {
  it('today() asks for the local day in plan order and maps rows', async () => {
    const db = new FakeDb();
    db.rows = [{ id: 's1', plan_id: 'p1', goal: 'Report', step_no: 1, title: 'Read the notes', status: 'done', plan_date: '2026-10-04', start_at: null, end_at: null },
               { id: 's2', plan_id: 'p1', goal: 'Report', step_no: 2, title: 'Find sources', status: 'weird', plan_date: '2026-10-04', start_at: '2026-10-04T13:00:00Z', end_at: null }];
    const steps = await store(db).today();
    expect(db.calls[0]!.text).toMatch(/WHERE plan_date = \$1::date ORDER BY created_at, step_no/);
    expect(db.calls[0]!.params).toEqual(['2026-10-04']);
    expect(steps[0]).toEqual({ id: 's1', planId: 'p1', goal: 'Report', stepNo: 1, title: 'Read the notes', status: 'done', planDate: '2026-10-04' });
    expect(steps[1]!.status).toBe('planned');                              // an unknown status is treated as planned
    expect(steps[1]!.startAt).toEqual(new Date('2026-10-04T13:00:00Z'));
  });

  it('completionToday says "3 of 4 done" and leaves out steps moved to another day', async () => {
    const db = new FakeDb();
    const row = (id: string, status: string) => ({ id, plan_id: 'p', goal: 'g', step_no: 1, title: id, status, plan_date: '2026-10-04' });
    db.rows = [row('a', 'done'), row('b', 'done'), row('c', 'done'), row('d', 'planned'), row('e', 'moved')];
    expect(await store(db).completionToday()).toEqual({ done: 3, total: 4, text: '3 of 4 done' });
    db.rows = [];
    expect(await store(db).completionToday()).toEqual({ done: 0, total: 0, text: 'No plan today' });
  });

  it('markStep updates by id and ignores an unknown status', async () => {
    const db = new FakeDb();
    await store(db).markStep('s1', 'done');
    await store(db).markStep('s1', 'finished' as any);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ text: 'UPDATE plan_items SET status = $2 WHERE id = $1', params: ['s1', 'done'] });
  });
});

describe('TigerPlanStore while Tiger is offline', () => {
  it('keeps working from memory, never throws, and never logs the connection string', async () => {
    const db = new FakeDb();
    db.down = true;
    const logs: string[] = [];
    const plans: PlanStore = store(db, logs);
    const saved = await plans.savePlan('Study plan', ['Chapter 1', 'Chapter 2', 'Quiz', 'Review']);
    await plans.markStep(saved[0]!.id, 'done');
    await plans.markStep(saved[1]!.id, 'done');
    await plans.markStep(saved[3]!.id, 'moved');
    expect((await plans.today()).map((s) => s.status)).toEqual(['done', 'done', 'planned', 'moved']);
    expect(await plans.completionToday()).toEqual({ done: 2, total: 3, text: '2 of 3 done' });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join(' ')).not.toContain('secret');
  });

  it('once Tiger is back, reads come from Tiger again', async () => {
    const db = new FakeDb();
    db.down = true;
    const plans = store(db, []);
    await plans.savePlan('Offline plan', ['Step']);
    db.down = false;
    db.rows = [];
    expect(await plans.today()).toEqual([]);
  });
});
