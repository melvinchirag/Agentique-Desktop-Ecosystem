import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock } from '../src/main/runtime/clock';
import { MemoryHistoryStore } from '../src/main/runtime/history';
import type { BiomeEventInput } from '../src/main/runtime/types';

const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

function setup() {
  const clock = new FakeClock(T0);
  const bus = new EventBus({ clock });
  const history = new MemoryHistoryStore({ bus, clock });
  const emit = (e: BiomeEventInput, advanceMs = 1000) => {
    const out = bus.emit(e);
    clock.advance(advanceMs);
    return out;
  };
  return { clock, bus, history, emit };
}

/** Three tasks: t1 (answered, tool use + deny), t2 (no answer, mood), t3 (no user.message). */
function seedThreeTasks(s: ReturnType<typeof setup>) {
  const { emit } = s;
  emit({ type: 'user.message', agentId: 'chipmunk', taskId: 't1', text: 'check my email', source: 'text' });
  emit({ type: 'user.mood', agentId: 'chipmunk', taskId: 't1', mood: 'calm', intensity: 0.3, reason: 'neutral' });
  emit({ type: 'tool.request', agentId: 'workspace', taskId: 't1', callId: 'c1', tool: 'gmail_list', args: {}, risk: 'read' });
  emit({ type: 'tool.result', agentId: 'workspace', taskId: 't1', callId: 'c1', ok: true, summary: '3 emails' });
  emit({ type: 'job.update', agentId: 'chipmunk', taskId: 't1', jobId: 'j1', to: 'workspace', state: 'done', title: 'Check email', requestedBy: 'chipmunk' });
  emit({ type: 'agent.say', agentId: 'chipmunk', taskId: 't1', text: 'first line', bubble: 'Hi', priority: 'ack' });
  emit({ type: 'agent.say', agentId: 'chipmunk', taskId: 't1', text: 'You have 3 emails.', bubble: 'Done', priority: 'chip' });
  emit({ type: 'agent.say', agentId: 'workspace', taskId: 't1', text: 'Mail sorted!', bubble: 'Pixel ✓', priority: 'report' });

  emit({ type: 'user.message', agentId: 'chipmunk', taskId: 't2', text: 'send the draft', source: 'voice' });
  emit({ type: 'user.mood', agentId: 'chipmunk', taskId: 't2', mood: 'stressed', intensity: 0.8, reason: 'deadline' });
  emit({ type: 'tool.request', agentId: 'workspace', taskId: 't2', callId: 'c2', tool: 'gmail_send', args: {}, risk: 'external' });
  emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: 't2', callId: 'c2', verdict: 'deny', rule: 'W1', reason: 'ADE never sends or posts for you.' });
  emit({ type: 'tool.result', agentId: 'workspace', taskId: 't2', callId: 'c2', ok: false, summary: 'denied' });
  emit({ type: 'job.update', agentId: 'chipmunk', taskId: 't2', jobId: 'j2', to: 'workspace', state: 'done', title: 'Send draft', requestedBy: 'chipmunk' });
  emit({ type: 'job.update', agentId: 'chipmunk', taskId: 't2', jobId: 'j3', to: 'beaver', state: 'running', title: 'Tidy', requestedBy: 'chipmunk' });

  // t3: only an agent event (e.g. a nudge-driven job), no user.message
  emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: 't3', callId: 'missing', verdict: 'allow', rule: 'W2', reason: 'ok' });
  emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: 't3', callId: 'ghost', verdict: 'deny', rule: 'W10', reason: 'unknown tool' });
  emit({ type: 'agent.say', agentId: 'chipmunk', taskId: 't3', text: 'no question here', bubble: '?', priority: 'chip' });
  emit({ type: 'tool.result', agentId: 'beaver', taskId: 't3', callId: 'c9', ok: true, summary: 'listed' });
  emit({ type: 'job.update', agentId: 'chipmunk', taskId: 't3', jobId: 'j4', to: 'beaver', state: 'done', title: 'List', requestedBy: 'chipmunk' });
  emit({ type: 'job.update', agentId: 'chipmunk', taskId: 't3', jobId: 'j5', to: 'beaver', state: 'done', title: 'List 2', requestedBy: 'chipmunk' });
}

describe('MemoryHistoryStore', () => {
  it('recent_tasks: groups by taskId, newest first, skips tasks without a user.message', async () => {
    const s = setup();
    seedThreeTasks(s);
    const rows = await s.history.query('recent_tasks', 24);
    expect(rows).toEqual([
      { at: new Date(T0 + 8 * 1000).toISOString(), asked: 'send the draft', answered: null },
      { at: new Date(T0).toISOString(), asked: 'check my email', answered: 'You have 3 emails.' },
    ]);
  });

  it('warden_blocks: deny verdicts only, agent + tool from the matching tool.request, null if missing', async () => {
    const s = setup();
    seedThreeTasks(s);
    const rows = await s.history.query('warden_blocks', 24);
    expect(rows).toEqual([
      { at: new Date(T0 + 16 * 1000).toISOString(), agent: null, tool: null, rule: 'W10', reason: 'unknown tool' },
      { at: new Date(T0 + 11 * 1000).toISOString(), agent: 'workspace', tool: 'gmail_send', rule: 'W1', reason: 'ADE never sends or posts for you.' },
    ]);
  });

  it('agent_activity: jobs (done, by target) + actions (tool.result), sorted by jobs desc', async () => {
    const s = setup();
    seedThreeTasks(s);
    // beaver's running job (j3) doesn't count; ties on jobs break by actions
    expect(await s.history.query('agent_activity', 24)).toEqual([
      { agent: 'workspace', jobs: 2, actions: 2 },
      { agent: 'beaver', jobs: 2, actions: 1 },
    ]);
  });

  it('mood_history: user.mood events, newest first', async () => {
    const s = setup();
    seedThreeTasks(s);
    expect(await s.history.query('mood_history', 24)).toEqual([
      { at: new Date(T0 + 9 * 1000).toISOString(), mood: 'stressed', intensity: 0.8 },
      { at: new Date(T0 + 1000).toISOString(), mood: 'calm', intensity: 0.3 },
    ]);
  });

  it('honours the since_hours window', async () => {
    const s = setup();
    s.emit({ type: 'user.mood', agentId: 'chipmunk', mood: 'sad', intensity: 0.5, reason: 'old' }, 5 * HOUR);
    s.emit({ type: 'user.message', agentId: 'chipmunk', taskId: 'old', text: 'old question', source: 'text' }, 0);
    s.clock.advance(HOUR);
    s.emit({ type: 'user.mood', agentId: 'chipmunk', mood: 'happy', intensity: 0.9, reason: 'new' }, 0);
    expect((await s.history.query('mood_history', 24)).map((r) => (r as { mood: string }).mood)).toEqual(['happy', 'sad']);
    expect((await s.history.query('mood_history', 2)).map((r) => (r as { mood: string }).mood)).toEqual(['happy']);
    expect(await s.history.query('recent_tasks', 0.5)).toEqual([]);
    expect(await s.history.query('recent_tasks', 24)).toHaveLength(1);
    // boundary: ts === now - since is included
    expect(await s.history.query('mood_history', 0)).toHaveLength(1);
  });

  it('honours the agent filter for each kind', async () => {
    const s = setup();
    seedThreeTasks(s);
    expect(await s.history.query('agent_activity', 24, 'beaver')).toEqual([{ agent: 'beaver', jobs: 2, actions: 1 }]);
    expect(await s.history.query('agent_activity', 24, 'eagle')).toEqual([]);
    expect(await s.history.query('warden_blocks', 24, 'workspace')).toHaveLength(1);
    expect(await s.history.query('warden_blocks', 24, 'beaver')).toEqual([]);
    expect(await s.history.query('recent_tasks', 24, 'workspace')).toHaveLength(2);
    expect(await s.history.query('recent_tasks', 24, 'beaver')).toEqual([]);
    expect(await s.history.query('mood_history', 24, 'workspace')).toEqual([]);
    expect(await s.history.query('mood_history', 24, 'chipmunk')).toHaveLength(2);
  });

  it('caps every kind at 20 rows, newest first', async () => {
    const s = setup();
    for (let i = 0; i < 25; i++) {
      s.emit({ type: 'user.message', agentId: 'chipmunk', taskId: `t${i}`, text: `q${i}`, source: 'text' });
      s.emit({ type: 'user.mood', agentId: 'chipmunk', mood: 'calm', intensity: i / 100, reason: 'r' });
      s.emit({ type: 'tool.request', agentId: 'beaver', taskId: `t${i}`, callId: `c${i}`, tool: 'fs_trash', args: {}, risk: 'destructive' });
      s.emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: `t${i}`, callId: `c${i}`, verdict: 'deny', rule: 'W4', reason: `r${i}` });
    }
    const tasks = (await s.history.query('recent_tasks', 24)) as { asked: string }[];
    expect(tasks).toHaveLength(20);
    expect(tasks[0]!.asked).toBe('q24');
    expect(tasks[19]!.asked).toBe('q5');
    const blocks = (await s.history.query('warden_blocks', 24)) as { reason: string }[];
    expect(blocks).toHaveLength(20);
    expect(blocks[0]!.reason).toBe('r24');
    const moods = (await s.history.query('mood_history', 24)) as { intensity: number }[];
    expect(moods).toHaveLength(20);
    expect(moods[0]!.intensity).toBe(0.24);
  });

  it('agent_activity: agents with no done jobs still appear, ordered by actions', async () => {
    const s = setup();
    s.emit({ type: 'tool.result', agentId: 'eagle', callId: 'a', ok: true, summary: 's' });
    s.emit({ type: 'tool.result', agentId: 'eagle', callId: 'b', ok: true, summary: 's' });
    s.emit({ type: 'tool.result', agentId: 'ants', callId: 'c', ok: true, summary: 's' });
    expect(await s.history.query('agent_activity', 24)).toEqual([
      { agent: 'eagle', jobs: 0, actions: 2 },
      { agent: 'ants', jobs: 0, actions: 1 },
    ]);
  });
});
