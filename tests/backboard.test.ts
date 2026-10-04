import { describe, expect, it } from 'vitest';
import { BackboardClient, BackboardError, normalizeMemories } from '../src/main/runtime/backboard';
import { BackboardMemoryApi } from '../src/main/sponsors/backboardMemory';
import { assistantIdsFromEnv } from '../src/main/sponsors/env';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
type Reply = { status?: number; json?: unknown } | Error | ((signal: AbortSignal) => Promise<Response>);

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const reply = replies.shift();
    if (!reply) throw new Error('no reply scripted');
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(init.signal);
    return new Response(JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}
const client = (replies: Reply[]) => {
  const f = fakeFetch(replies);
  return { ...f, c: new BackboardClient({ apiKey: 'test-key', fetch: f.fn, defaultModel: { llm_provider: 'google', model_name: 'gemini-2.5-flash' } }) };
};
const OK = { json: { thread_id: 't1', status: 'COMPLETED', content: 'hi', tool_calls: null, retrieved_memories: null } };

describe('BackboardClient.send', () => {
  it('sends the documented body and the API key header', async () => {
    const { c, calls } = client([OK]);
    await c.send({ assistantId: 'a1', threadId: 't1', content: 'hello', systemPrompt: 'sys', memory: 'Readonly', webSearch: 'Auto', jsonOutput: true,
      tools: [{ type: 'function', function: { name: 'x', description: 'd', parameters: {} } }] });
    expect(calls[0]!.url).toBe('https://app.backboard.io/api/threads/messages');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['X-API-Key']).toBe('test-key');
    expect(calls[0]!.body).toMatchObject({ assistant_id: 'a1', thread_id: 't1', content: 'hello', system_prompt: 'sys', memory: 'Readonly',
      web_search: 'Auto', json_output: true, llm_provider: 'google', model_name: 'gemini-2.5-flash', stream: false });
    expect(calls[0]!.body.tools).toHaveLength(1);
  });

  it('leaves out optional fields that were not given', async () => {
    const { c, calls } = client([OK]);
    await c.send({ assistantId: 'a1', content: 'hello' });
    for (const key of ['thread_id', 'system_prompt', 'tools', 'memory', 'web_search', 'json_output']) expect(calls[0]!.body).not.toHaveProperty(key);
  });

  it('a per-call model wins over the default', async () => {
    const { c, calls } = client([OK]);
    await c.send({ assistantId: 'a1', content: 'x', model: { llm_provider: 'anthropic', model_name: 'claude-sonnet-5-5' } });
    expect(calls[0]!.body).toMatchObject({ llm_provider: 'anthropic', model_name: 'claude-sonnet-5-5' });
  });

  it('returns tool calls and normalizes retrieved memories to texts', async () => {
    const { c } = client([{ json: { thread_id: 't9', status: 'REQUIRES_ACTION', content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'report_user_mood', arguments: '{"mood":"angry"}' } }],
      retrieved_memories: [{ id: 'm1', memory: 'likes peanut butter' }, 'plain text', { content: 'from content' }, { other: 1 }] } }]);
    const r = await c.send({ assistantId: 'a1', content: 'x' });
    expect(r.status).toBe('REQUIRES_ACTION');
    expect(r.thread_id).toBe('t9');
    expect(r.tool_calls![0]!.function.name).toBe('report_user_mood');
    expect(r.retrieved_memories).toEqual(['likes peanut butter', 'plain text', 'from content']);
  });

  it('null retrieved_memories stays null', () => {
    expect(normalizeMemories(null)).toBeNull();
    expect(normalizeMemories(undefined)).toBeNull();
  });
});

describe('BackboardClient retry policy', () => {
  it('retries once on a 5xx, then succeeds', async () => {
    const { c, calls } = client([{ status: 503, json: { detail: 'busy' } }, OK]);
    expect((await c.send({ assistantId: 'a1', content: 'x' })).content).toBe('hi');
    expect(calls).toHaveLength(2);
  });

  it('retries once on a network error', async () => {
    const { c, calls } = client([new TypeError('fetch failed'), OK]);
    await c.send({ assistantId: 'a1', content: 'x' });
    expect(calls).toHaveLength(2);
  });

  it('gives up after the second failure', async () => {
    const { c, calls } = client([{ status: 500 }, { status: 502, json: { detail: 'bad gateway' } }]);
    await expect(c.send({ assistantId: 'a1', content: 'x' })).rejects.toMatchObject({ name: 'BackboardError', status: 502 });
    expect(calls).toHaveLength(2);
  });

  it('never retries a 4xx, and throws status + body', async () => {
    const { c, calls } = client([{ status: 400, json: { detail: 'bad model' } }, OK]);
    const err = await c.send({ assistantId: 'a1', content: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(BackboardError);
    expect(err.status).toBe(400);
    expect(err.body).toContain('bad model');
    expect(calls).toHaveLength(1);
  });

  it('never retries when the caller aborts', async () => {
    const ctrl = new AbortController();
    const hang: Reply = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
    const { c, calls } = client([hang, OK]);
    const pending = c.send({ assistantId: 'a1', content: 'x', signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(1);
  });

  it('retries once on a timeout', async () => {
    const hang: Reply = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout'))));
    const { c, calls } = client([hang, OK]);
    await c.send({ assistantId: 'a1', content: 'x', timeoutMs: 20 });
    expect(calls).toHaveLength(2);
  });
});

describe('BackboardClient other calls', () => {
  it('submitToolOutputs posts thread_id and every output', async () => {
    const { c, calls } = client([OK]);
    await c.submitToolOutputs('t1', [{ tool_call_id: 'c1', output: '{}' }, { tool_call_id: 'c2', output: 'ok' }]);
    expect(calls[0]!.url).toMatch(/\/threads\/tool-outputs$/);
    expect(calls[0]!.body).toEqual({ thread_id: 't1', tool_outputs: [{ tool_call_id: 'c1', output: '{}' }, { tool_call_id: 'c2', output: 'ok' }] });
  });

  it('listModels filters to tool-capable chat models with a limit', async () => {
    const { c, calls } = client([{ json: { models: [{ name: 'gemini-2.5-flash', provider: 'google' }], total: 13438 } }]);
    expect(await c.listModels({ limit: 50 })).toEqual([{ name: 'gemini-2.5-flash', provider: 'google' }]);
    expect(calls[0]!.url).toContain('/models?model_type=llm&supports_tools=true&limit=50');
  });

  it('createAssistant sends the memory prompts and returns assistant_id', async () => {
    const { c, calls } = client([{ json: { assistant_id: 'new-id' } }]);
    expect(await c.createAssistant({ name: 'ADE · Chip', systemPrompt: 's', factExtractionPrompt: 'f', updateMemoryPrompt: 'u' })).toEqual({ assistantId: 'new-id' });
    expect(calls[0]!.body).toEqual({ name: 'ADE · Chip', system_prompt: 's', custom_fact_extraction_prompt: 'f', custom_update_memory_prompt: 'u' });
  });

  it('createAssistant without memory prompts sends none (Warden)', async () => {
    const { c, calls } = client([{ json: { assistant_id: 'w' } }]);
    await c.createAssistant({ name: 'ADE · Warden', systemPrompt: 's' });
    expect(calls[0]!.body).toEqual({ name: 'ADE · Warden', system_prompt: 's' });
  });

  it('refuses to start without an API key', () => {
    expect(() => new BackboardClient({ apiKey: '' })).toThrow(/BACKBOARD_API_KEY/);
  });
});

describe('BackboardMemoryApi', () => {
  const setup = (replies: Reply[]) => {
    const { c, calls } = client(replies);
    return { calls, api: new BackboardMemoryApi(c, assistantIdsFromEnv({ BB_ASSISTANT_CHIPMUNK: 'chip-id' })) };
  };

  it('list maps Backboard memories to the contract shape', async () => {
    const { api, calls } = setup([{ json: { memories: [{ id: 'm1', content: 'likes tea', metadata: {}, score: null, created_at: '2026-10-04', updated_at: null }], total_count: 1 } }]);
    expect(await api.list('chipmunk')).toEqual([{ id: 'm1', content: 'likes tea', created_at: '2026-10-04' }]);
    expect(calls[0]!.url).toBe('https://app.backboard.io/api/assistants/chip-id/memories');
  });

  it('search is a POST with the query', async () => {
    const { api, calls } = setup([{ json: { memories: [{ id: 'm1', content: 'likes tea', score: 0.5 }] } }]);
    expect(await api.search('chipmunk', 'tea')).toEqual([{ id: 'm1', content: 'likes tea' }]);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toMatch(/\/assistants\/chip-id\/memories\/search$/);
    expect(calls[0]!.body).toEqual({ query: 'tea', limit: 20 });
  });

  it('update is a PUT and remove is a DELETE on the memory id', async () => {
    const { api, calls } = setup([{ json: {} }, { json: { success: true } }]);
    await api.update('chipmunk', 'm1', 'likes coffee');
    await api.remove('chipmunk', 'm1');
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://app.backboard.io/api/assistants/chip-id/memories/m1', body: { content: 'likes coffee' } });
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://app.backboard.io/api/assistants/chip-id/memories/m1' });
  });

  it('add returns the new memory id', async () => {
    const { api } = setup([{ status: 201, json: { success: true, memory_id: 'm7' } }]);
    expect(await api.add('chipmunk', 'style profile')).toEqual({ id: 'm7' });
  });

  it('an animal with no assistant gives a clear error', async () => {
    const { api } = setup([]);
    await expect(api.list('wolf')).rejects.toThrow(/BB_ASSISTANT_WOLF/);
  });
});

describe('memory rules', () => {
  it('every animal except Warden has rules, and the format block asks for {"facts": [...]}', async () => {
    const { withFactFormat } = await import('../src/main/sponsors/memoryFormat');
    for (const id of ['chipmunk', 'workspace', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale']) {
      const rules = await import(`../src/main/agents/${id}/memory-rules.ts`);
      expect(rules.FACT_EXTRACTION_PROMPT).toMatch(/Never extract/);
      const full = withFactFormat(rules.FACT_EXTRACTION_PROMPT, rules.FACT_EXAMPLE);
      expect(full).toContain('{"facts": []}');
      expect(full).toContain(JSON.stringify({ facts: rules.FACT_EXAMPLE.facts }));
    }
    const wolf = await import('../src/main/agents/wolf/memory-rules');
    expect(wolf.FACT_EXTRACTION_PROMPT).toBeUndefined();
  });
});
