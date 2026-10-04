import { describe, expect, it } from 'vitest';
import { TigerQueries } from '../src/main/store/tigerQueries';
import type { Db } from '../src/main/store/tiger';

describe('Hub Tiger responses', () => {
  it('maps mood, completed jobs, and Warden counts into the Pulse response', async () => {
    const db: Db = { query: async (sql) => ({ rows:
      sql.includes('FROM mood_daily') ? [
        { day: new Date('2026-10-04T00:00:00Z'), mood: 'happy', times: 3, avg_intensity: 0.82 },
        { day: new Date('2026-10-04T00:00:00Z'), mood: 'calm', times: 1, avg_intensity: 0.5 },
      ] : sql.includes('FROM job_stats_daily') ? [
        { agent: 'beaver', done: 4, failed: 1 }, { agent: 'eagle', done: 2, failed: 0 },
      ] : sql.includes('FROM warden_daily') ? [
        { verdict: 'deny', times: 2 }, { verdict: 'ask', times: 3 },
      ] : [],
    }) };
    const pulse = await new TigerQueries(db, () => {}).pulse();
    expect(pulse.moodWeek).toEqual([
      { day: '2026-10-04', mood: 'happy', score: 0.82 },
      { day: '2026-10-04', mood: 'calm', score: 0.5 },
    ]);
    expect(pulse.jobsPerAgent).toEqual({ beaver: 4, eagle: 2 });
    expect([pulse.wardenBlocks, pulse.wardenAsks]).toEqual([2, 3]);
  });

  it('maps SQL audit columns, timestamp, asking animal, and Replay task id', async () => {
    const taskId = 'b72db126-b871-4a44-b357-8f0ff14c7550';
    const db: Db = { query: async () => ({ rows: [
      { ts: new Date('2026-10-04T15:12:00Z'), task_id: taskId, agent_id: 'wolf', asking_agent: 'beaver', tool: 'fs_trash', verdict: 'deny', rule: 'W3', reason: 'Needs approval' },
      { ts: '2026-10-04T15:13:00Z', task_id: null, agent_id: 'wolf', asking_agent: null, tool: null, verdict: null, rule: null, reason: null },
    ] }) };
    expect(await new TigerQueries(db, () => {}).wardenAudit(2)).toEqual([
      { ts: Date.parse('2026-10-04T15:12:00Z'), taskId, agentId: 'beaver', tool: 'fs_trash', verdict: 'deny', rule: 'W3', reason: 'Needs approval' },
      { ts: Date.parse('2026-10-04T15:13:00Z'), agentId: 'wolf', tool: '', verdict: 'alert', rule: '', reason: '' },
    ]);
  });
});
