import { describe, expect, it } from 'vitest';
import { openLocalDb } from './localDb';
import { LocalEventSink } from './localEvents';
import { LocalHistoryStore, LocalNudgeStore, LocalPlanStore, LocalResearchStore } from './localStores';
import type { BiomeEvent } from '../../shared/events';

describe('local stores on ade.db', () => {
  it('nudges: insert, due in order, one per calendar event and kind, update and snooze', async () => {
    const db = openLocalDb(':memory:');
    const store = new LocalNudgeStore(db);
    const at = (m: number) => new Date(1_000_000 + m * 60_000);
    await store.insert({ id: 'n2', kind: 'daily', about: 'day', question: 'How was today?', askAt: at(10), state: 'pending', source: 'rule' });
    await store.insert({ id: 'n1', kind: 'before', about: 'exam', question: 'Ready?', askAt: at(5), state: 'pending', source: 'planner', eventId: 'ev1' });
    await store.insert({ id: 'n1b', kind: 'before', about: 'exam moved', question: 'Ready now?', askAt: at(6), state: 'pending', source: 'planner', eventId: 'ev1' });
    expect((await store.due(at(20))).map((n) => n.id)).toEqual(['n1b', 'n2']);
    expect((await store.findByEvent('ev1', 'before'))?.about).toBe('exam moved');
    await store.update('n2', { state: 'snoozed', askAt: at(120) });
    expect((await store.due(at(20))).map((n) => n.id)).toEqual(['n1b']);
    expect((await store.due(at(130))).map((n) => n.id)).toEqual(['n1b', 'n2']);
    await store.update('n1b', { state: 'cancelled' });
    expect(await store.findByEvent('ev1', 'before')).toBeNull();
  });

  it('plans: save, read today in order, mark, and count completion', async () => {
    const db = openLocalDb(':memory:');
    const now = () => new Date(2026, 10, 2, 9, 0).getTime();
    const plans = new LocalPlanStore(db, now);
    const steps = await plans.savePlan('Write the report', ['Collect sources', { title: 'Draft', startAt: new Date(now() + 3600_000) }, 'Send to Chip']);
    expect(steps.map((s) => s.stepNo)).toEqual([1, 2, 3]);
    await plans.markStep(steps[0]!.id, 'done');
    await plans.markStep(steps[2]!.id, 'moved');
    const today = await plans.today();
    expect(today.map((s) => [s.title, s.status])).toEqual([['Collect sources', 'done'], ['Draft', 'planned'], ['Send to Chip', 'moved']]);
    expect(today[1]!.startAt?.getTime()).toBe(now() + 3600_000);
    expect(await plans.completionToday()).toEqual({ done: 1, total: 2, text: '1 of 2 done' });
  });

  it('research: record and find by title since a time', async () => {
    const db = openLocalDb(':memory:');
    const research = new LocalResearchStore(db);
    await research.record('Best pizza near campus', ['https://a.example', 'https://b.example'], 'C:/briefs/pizza.md');
    await research.record('Water cycle notes', []);
    const found = await research.find(new Date(Date.now() - 60_000), 'pizza');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: 'Best pizza near campus', sources: ['https://a.example', 'https://b.example'], brief_path: 'C:/briefs/pizza.md' });
    expect(await research.find(new Date(Date.now() - 60_000))).toHaveLength(2);
  });

  it('biome_history answers the four questions from the local event log', async () => {
    const db = openLocalDb(':memory:');
    const sink = new LocalEventSink(db);
    const t0 = Date.now() - 3600_000;
    const ev = (ms: number, e: Record<string, unknown>) => ({ id: crypto.randomUUID(), ts: t0 + ms, sessionId: 's', ...e }) as BiomeEvent;
    for (const e of [
      ev(0, { type: 'user.message', agentId: 'chipmunk', taskId: 't1', text: 'Tidy my desktop', source: 'text' }),
      ev(1, { type: 'user.mood', agentId: 'chipmunk', taskId: 't1', mood: 'calm', intensity: 0.4, summary: '' }),
      ev(2, { type: 'job.update', agentId: 'chipmunk', taskId: 't1', jobId: 'j1', to: 'beaver', state: 'running', title: 'Tidy', requestedBy: 'chipmunk' }),
      ev(3, { type: 'tool.request', agentId: 'beaver', taskId: 't1', callId: 'c1', tool: 'fs_trash', args: {}, risk: 'destructive' }),
      ev(4, { type: 'wolf.verdict', agentId: 'wolf', taskId: 't1', callId: 'c1', verdict: 'deny', rule: 'W4', reason: 'No deleting' }),
      ev(5, { type: 'tool.result', agentId: 'beaver', taskId: 't1', callId: 'c1', ok: false }),
      ev(6, { type: 'job.update', agentId: 'chipmunk', taskId: 't1', jobId: 'j1', to: 'beaver', state: 'done', title: 'Tidy', requestedBy: 'chipmunk' }),
      ev(7, { type: 'agent.say', agentId: 'chipmunk', taskId: 't1', text: 'Archie tidied it, but Warden stopped one delete.', bubble: 'Done', priority: 'chip' }),
    ]) sink.enqueue(e);
    await sink.flush();
    const history = new LocalHistoryStore(db, () => Date.now(), new LocalResearchStore(db));
    const recent = await history.query('recent_tasks', 24) as { asked: string; answered: string }[];
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ asked: 'Tidy my desktop', answered: 'Archie tidied it, but Warden stopped one delete.' });
    const blocks = await history.query('warden_blocks', 24) as { agent: string; tool: string; rule: string }[];
    expect(blocks).toEqual([expect.objectContaining({ agent: 'beaver', tool: 'fs_trash', rule: 'W4', reason: 'No deleting' })]);
    expect(await history.query('warden_blocks', 24, 'eagle')).toEqual([]);
    const activity = await history.query('agent_activity', 24) as { agent: string; jobs: number; failed: number; actions: number }[];
    expect(activity).toEqual([expect.objectContaining({ agent: 'beaver', jobs: 1, failed: 0, actions: 1 })]);
    const mood = await history.query('mood_history', 24) as { mood: string; times: number }[];
    expect(mood).toEqual([expect.objectContaining({ mood: 'calm', times: 1 })]);
  });
});
