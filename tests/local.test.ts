// ADE's own data on the machine: events + Hub queries, memories + recall + learning, conversation threads.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BiomeEvent } from '../src/shared/events';
import { LocalMemoryStore, parseFacts, withLocalMemory } from '../src/main/memory/localMemory';
import { completed, FakeLlm } from '../src/main/testing/fakeLlm';
import { openLocalDb } from '../src/main/store/localDb';
import { LocalEventSink, LocalQueries } from '../src/main/store/localEvents';
import { SqliteThreadStore } from '../src/main/store/localThreads';

const ev = (n: number, type: string, extra: Record<string, unknown> = {}): BiomeEvent =>
  ({ id: `e${n}`, ts: 1_700_000_000_000 + n, sessionId: 's1', taskId: 't1', agentId: 'wolf', type, ...extra }) as unknown as BiomeEvent;

describe('local events', () => {
  it('stores events and answers Timeline, Replay, Audit and Pulse with no cloud database', async () => {
    const db = openLocalDb(':memory:', () => 1_700_000_000_000);
    const sink = new LocalEventSink(db);
    sink.enqueue(ev(1, 'user.message', { agentId: 'chipmunk', text: 'send it' }));
    sink.enqueue(ev(2, 'tool.request', { agentId: 'workspace', callId: 'c1', tool: 'gmail_send', risk: 'external' }));
    sink.enqueue(ev(3, 'wolf.verdict', { callId: 'c1', verdict: 'deny', rule: 'W1', reason: 'ADE never sends' }));
    sink.enqueue(ev(4, 'user.mood', { agentId: 'chipmunk', mood: 'calm', intensity: 0.4 }));
    sink.enqueue({ ...ev(5, 'user.message'), text: 'x'.repeat(5000) } as BiomeEvent);   // over the privacy cap: dropped
    await sink.flush();
    const q = new LocalQueries(db, () => 1_700_000_000_010);
    expect((await q.timeline(0, Number.MAX_SAFE_INTEGER)).map((e) => e.type)).toEqual(['user.message', 'tool.request', 'wolf.verdict', 'user.mood']);
    expect((await q.taskEvents('t1'))[1]).toMatchObject({ type: 'tool.request', callId: 'c1', tool: 'gmail_send', taskId: 't1' });
    expect(await q.wardenAudit(10)).toEqual([{ ts: 1_700_000_000_003, taskId: 't1', agentId: 'workspace', tool: 'gmail_send', verdict: 'deny', rule: 'W1', reason: 'ADE never sends' }]);
    const pulse = await q.pulse();
    expect(pulse.wardenBlocks).toBe(1);
    expect(pulse.moodWeek).toEqual([{ day: '2023-11-14', mood: 'calm', score: 0.4 }]);
  });
});

describe('local memories', () => {
  it('list, search by whole words, update, remove, import; survives reopening the file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ade-db-')), 'ade.db');
    const store = new LocalMemoryStore(openLocalDb(file));
    const { id } = await store.add('chipmunk', 'CS 280 midterm is on Thursday');
    await store.add('chipmunk', 'Prefers tea over coffee');
    await store.add('beaver', 'Thursday backup of the Desktop');
    expect((await store.search('chipmunk', 'when is the midterm?')).map((m) => m.content)).toEqual(['CS 280 midterm is on Thursday']);
    expect(await store.search('chipmunk', 'the')).toEqual([]);                       // common word, no match inside "nothing"
    await store.update('chipmunk', id, 'CS 280 midterm moved to Friday');
    expect(await store.importRows('chipmunk', [{ id: 'bb1', content: 'Name is Sam' }, { id: 'bb2', content: 'name is sam' }])).toEqual({ added: 1, skipped: 1 });
    await store.remove('beaver', (await store.list('beaver'))[0]!.id);
    const reopened = new LocalMemoryStore(openLocalDb(file));
    expect((await reopened.list('chipmunk')).map((m) => m.content).sort()).toEqual(['CS 280 midterm moved to Friday', 'Name is Sam', 'Prefers tea over coffee']);
    expect(await reopened.list('beaver')).toEqual([]);
  });

  it('puts relevant memories in the turn with vendor memory off, reports them, and learns new facts with the animal rules', async () => {
    const store = new LocalMemoryStore(openLocalDb(':memory:'));
    await store.add('chipmunk', 'CS 280 midterm is on Thursday');
    const inner = new FakeLlm([completed('Thursday.'), completed('```json\n{"facts": ["Name is Sam", "Name is Sam"]}\n```'), completed('ok')]);
    const ids: Record<string, 'chipmunk' | 'wolf'> = { 'as-chip': 'chipmunk', 'as-wolf': 'wolf' };
    const llm = withLocalMemory(inner, store, { agentFor: (a) => ids[a] });

    const res = await llm.send({ assistantId: 'as-chip', content: "I'm Sam. When is my midterm?", memory: 'Auto' });
    await llm.whenIdle();
    const turn = inner.calls[0]!, learn = inner.calls[1]!;
    if (turn.kind !== 'send' || learn.kind !== 'send') throw new Error('expected sends');
    expect(turn.params.memory).toBe('off');
    expect(turn.params.content).toBe("[memories]\n- CS 280 midterm is on Thursday\n[/memories]\n\nI'm Sam. When is my midterm?");
    expect(res.retrieved_memories).toEqual(['CS 280 midterm is on Thursday']);
    expect(learn.params).toMatchObject({ jsonOutput: true, memory: 'off', tools: [] });
    expect(learn.params.systemPrompt).toContain('Extract only durable facts about the USER');
    expect((await store.list('chipmunk')).map((m) => m.content).sort()).toEqual(['CS 280 midterm is on Thursday', 'Name is Sam']);

    await llm.send({ assistantId: 'as-wolf', content: 'screen this midterm text', memory: 'Auto' });   // Warden: untouched, never learns
    const wolf = inner.calls[2]!;
    expect(wolf.kind === 'send' && wolf.params.content).toBe('screen this midterm text');
    expect(inner.calls).toHaveLength(3);
    expect(parseFacts('no json')).toEqual([]);
  });
});

describe('local threads', () => {
  it('keeps order, windows by token budget with the system message, never orphans a tool result, and prunes', () => {
    const threads = new SqliteThreadStore(openLocalDb(':memory:'));
    const id = threads.create('chipmunk');
    threads.append(id, [
      { role: 'system', content: 'Chip', ts: 1 },
      { role: 'user', content: 'clean up my Desktop please, it is a mess', ts: 2 },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'delegate', arguments: '{"agent":"beaver"}' } }], ts: 3 },
      { role: 'tool', content: 'Archie planned 14 moves', toolCallId: 'c1', ts: 4 },
      { role: 'assistant', content: 'Archie is on it.', ts: 5 },
    ]);
    expect(threads.get(id).map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
    expect(threads.window(id, 1000).map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
    expect(threads.window(id, 12).map((m) => m.role)).toEqual(['system', 'assistant']);   // tool result dropped with its request
    threads.prune(id);
    expect(threads.get(id)).toEqual([]);
  });
});
