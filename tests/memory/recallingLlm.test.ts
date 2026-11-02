import { describe, expect, it } from 'vitest';
import { parseFacts, RecallingLlm } from '../../src/main/memory/recallingLlm';
import { completed, FakeLlm } from '../../src/main/testing/fakeLlm';
import { InMemoryMemoryStore } from '../../src/main/testing/inMemoryMemoryStore';

const IDS: Record<string, 'chipmunk' | 'beaver' | 'wolf'> = { 'as-chip': 'chipmunk', 'as-beaver': 'beaver', 'as-wolf': 'wolf' };
const agentFor = (assistantId: string) => IDS[assistantId];

function setup(script: Parameters<typeof FakeLlm.prototype.push>, extract = true) {
  const inner = new FakeLlm(script);
  const store = new InMemoryMemoryStore();
  const errors: unknown[] = [];
  const llm = new RecallingLlm({ inner, recall: store, writer: store, agentFor, extract, onError: (_a, e) => errors.push(e) });
  return { inner, store, llm, errors };
}

describe('RecallingLlm', () => {
  it('prepends recalled memories, forwards with memory off, and reports them as retrieved_memories', async () => {
    const { inner, store, llm } = setup([completed('Thursday it is.')], false);
    await store.add('chipmunk', 'CS 280 midterm is on Thursday');
    await store.add('chipmunk', 'Prefers tea over coffee');
    const res = await llm.send({ assistantId: 'as-chip', content: 'when is my midterm?', memory: 'Auto' });
    const sent = inner.calls[0]!;
    expect(sent.kind).toBe('send');
    if (sent.kind !== 'send') return;
    expect(sent.params.memory).toBe('off');
    expect(sent.params.content).toMatch(/^\[memories\]\n- CS 280 midterm is on Thursday\n\[\/memories\]\n\nwhen is my midterm\?$/);
    expect(res.retrieved_memories).toEqual(['CS 280 midterm is on Thursday']);
    expect(res.content).toBe('Thursday it is.');
  });

  it('leaves Warden, memory-off calls and unknown assistants untouched', async () => {
    const { inner, store, llm } = setup([completed('a'), completed('b'), completed('c')], false);
    await store.add('wolf', 'never used');
    await llm.send({ assistantId: 'as-wolf', content: 'screen this', memory: 'Auto' });
    await llm.send({ assistantId: 'as-chip', content: 'plan nudges', memory: 'off' });
    await llm.send({ assistantId: 'as-unknown', content: 'hello', memory: 'Auto' });
    for (const c of inner.calls) {
      if (c.kind !== 'send') continue;
      expect(c.params.content).not.toContain('[memories]');
    }
    expect((inner.calls[1] as { kind: 'send'; params: { memory?: string } }).params.memory).toBe('off');
  });

  it('after an Auto turn, extracts facts with the animal rules in one extra call and stores new ones once', async () => {
    const { inner, store, llm } = setup([
      completed('Nice to meet you, Sam.'),
      completed('{"facts": ["Name is Sam", "Junior at EMU", "Name is Sam"]}'),
      completed('Got it.'),
      completed('```json\n{"facts": ["Junior at EMU", "CS 280 midterm on 2026-10-05"]}\n```'),
    ]);
    await llm.send({ assistantId: 'as-chip', content: "I'm Sam, a junior at EMU.", memory: 'Auto' });
    await llm.whenIdle();
    const extraction = inner.calls[1]!;
    expect(extraction.kind).toBe('send');
    if (extraction.kind !== 'send') return;
    expect(extraction.params.jsonOutput).toBe(true);
    expect(extraction.params.memory).toBe('off');
    expect(extraction.params.systemPrompt).toContain('Return the facts as JSON');
    expect(extraction.params.systemPrompt).toContain('Extract only durable facts about the USER');
    expect((await store.list('chipmunk')).map((m) => m.content).sort()).toEqual(['Junior at EMU', 'Name is Sam']);

    await llm.send({ assistantId: 'as-chip', content: 'My CS 280 midterm is on 2026-10-05.', memory: 'Auto' });
    await llm.whenIdle();
    expect((await store.list('chipmunk')).map((m) => m.content).sort()).toEqual(['CS 280 midterm on 2026-10-05', 'Junior at EMU', 'Name is Sam']);
    expect(inner.calls).toHaveLength(4);
  });

  it('Readonly turns recall but never extract; an extraction failure never surfaces to the caller', async () => {
    const { inner, store, llm, errors } = setup([completed('ok'), completed('ok'), new Error('vendor down')]);
    await store.add('beaver', 'Class notes go in Documents/EMU');
    const res = await llm.send({ assistantId: 'as-beaver', content: 'tidy my class notes', memory: 'Readonly' });
    expect(res.retrieved_memories).toEqual(['Class notes go in Documents/EMU']);
    expect(inner.calls).toHaveLength(1);
    await llm.send({ assistantId: 'as-beaver', content: 'I keep notes in Documents/EMU', memory: 'Auto' });
    await llm.whenIdle();
    expect(inner.calls).toHaveLength(3);
    expect(errors).toHaveLength(1);
    expect(await store.list('beaver')).toHaveLength(1);
  });

  it('parseFacts tolerates fences and prose and rejects junk', () => {
    expect(parseFacts('Sure! ```json\n{"facts":["A","B"]}\n``` done')).toEqual(['A', 'B']);
    expect(parseFacts('{"facts": []}')).toEqual([]);
    expect(parseFacts('{"facts": "not a list"}')).toEqual([]);
    expect(parseFacts('no json here')).toEqual([]);
    expect(parseFacts(null)).toEqual([]);
  });
});
