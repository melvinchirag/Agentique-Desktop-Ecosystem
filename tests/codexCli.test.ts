import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { CodexCliClient, type CodexCliOptions } from '../src/main/brain/codexCli';
import { ClaudeCliClient } from '../src/main/brain/claudeCli';
import { windowMessages, type ThreadMessage, type ThreadStore } from '../src/main/store/localThreads';
import type { OpenAiTool } from '../src/main/runtime/types';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const tools: OpenAiTool[] = [{ type: 'function', function: { name: 'fs_list', description: 'List a folder',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
const params = { assistantId: 'chipmunk', systemPrompt: 'You are Chip.', content: 'List C:\\Demo', tools };
const message = (text: string) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } });
const action = JSON.stringify({ actions: [{ action: 'fs_list', input: JSON.stringify({ path: 'C:\\Demo' }) }], content: '' });
function threads(): ThreadStore {
  const all = new Map<string, ThreadMessage[]>();
  return {
    create: prefix => { const id = `${prefix}-${all.size}`; all.set(id, []); return id; },
    append: (id, messages) => { all.get(id)!.push(...messages.map(m => ({ ...m, tokens: Math.ceil(m.content.length / 4) }))); },
    get: id => all.get(id) ?? [], window: (id, budget) => windowMessages(all.get(id) ?? [], budget), prune: id => { all.delete(id); },
  };
}
function client(run: NonNullable<CodexCliOptions['run']>, options: Partial<CodexCliOptions> = {}) {
  return new CodexCliClient({ threads: threads(), run, ...options });
}

describe('Codex CLI brain', () => {
  it('returns an offered action as a valid tool call and saves it in ADE history', async () => {
    const store = threads();
    const result = await client(async () => message(action), { threads: store }).send(params);
    expect(result).toMatchObject({ status: 'REQUIRES_ACTION', model_provider: 'openai',
      tool_calls: [{ type: 'function', function: { name: 'fs_list', arguments: JSON.stringify({ path: 'C:\\Demo' }) } }] });
    expect(result.tool_calls![0]!.id).toMatch(/^call_/);
    expect(store.get(result.thread_id!).map(m => m.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('filters unknown actions while keeping the answer', async () => {
    const text = JSON.stringify({ actions: [{ action: 'fs_delete', input: '{}' }], content: 'Cannot do that.' });
    expect(await client(async () => message(text)).send(params)).toMatchObject({ status: 'COMPLETED', content: 'Cannot do that.', tool_calls: null });
  });

  it('takes content from the output file before falling back to the last agent message', async () => {
    let dir = '';
    const result = await client(async args => {
      const output = args[args.indexOf('-o') + 1]!;
      dir = dirname(output);
      writeFileSync(output, JSON.stringify({ actions: [], content: 'a.pdf and b.txt' }));
      return message('wrong result');
    }).send(params);
    expect(result).toMatchObject({ status: 'COMPLETED', content: 'a.pdf and b.txt' });
    expect(existsSync(dir)).toBe(false);
    expect(await client(async () => [message('old'), message('new')].join('\n')).send({ ...params, tools: [] })).toMatchObject({ status: 'COMPLETED', content: 'new' });
  });

  it('isolates the CLI and supplies a strict schema only for action decisions', async () => {
    const run = vi.fn<NonNullable<CodexCliOptions['run']>>(async (args, stdin) => {
      expect(args.join(' ')).toContain('--disable shell_tool --disable unified_exec');
      expect(args.join(' ')).toContain('-s read-only');
      for (const flag of ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--json']) expect(args).toContain(flag);
      expect(args).toContain('web_search=disabled');
      expect(args).toContain('model_reasoning_effort=low');
      expect(stdin).toMatch(/^INSTRUCTIONS:\nYou are Chip\./);
      if (args.includes('--output-schema')) {
        const schema = JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1]!, 'utf8'));
        expect(schema.required).toEqual(['actions', 'content']);
        expect(schema.additionalProperties).toBe(false);
        expect(schema.properties.actions.items).toMatchObject({ required: ['action', 'input'], additionalProperties: false });
      }
      return message('{"actions":[],"content":"ok"}');
    });
    const c = client(run);
    await c.send(params);
    await c.send({ ...params, tools: [] });
    await c.send({ ...params, jsonOutput: true });
    expect(run.mock.calls.map(([args]) => args.includes('--output-schema'))).toEqual([true, false, false]);
  });

  it('uses OpenAI model overrides, otherwise the configured default, with explicit web search', async () => {
    const run = vi.fn<NonNullable<CodexCliOptions['run']>>(async () => message('ok'));
    const c = client(run, { model: 'default-model' });
    await c.send({ ...params, tools: [], webSearch: 'Auto', model: { llm_provider: 'openai', model_name: 'selected-model' } });
    await c.send({ ...params, tools: [], model: { llm_provider: 'google', model_name: 'other-model' } });
    expect(run.mock.calls).toHaveLength(2);
    const calls = run.mock.calls;
    expect(calls[0]![0]).toEqual(expect.arrayContaining(['-m', 'selected-model', 'web_search=live']));
    expect(calls[1]![0]).toEqual(expect.arrayContaining(['-m', 'default-model', 'web_search=disabled']));
  });

  it('rejects error events and empty output, removing temporary files on failures', async () => {
    for (const event of [{ type: 'error', message: 'auth failed' }, { type: 'turn.failed', error: { message: 'auth failed' } }, null]) {
      let dir = '';
      const c = client(async args => {
        const output = args[args.indexOf('-o') + 1]!;
        dir = dirname(output);
        if (event) writeFileSync(output, 'stale answer');
        return event ? JSON.stringify(event) : '';
      });
      await expect(c.send(params)).rejects.toThrow(event ? 'codex: auth failed' : 'codex: no output');
      expect(existsSync(dir)).toBe(false);
    }
  });

  it('re-offers the same tools and system instructions after tool outputs', async () => {
    const store = threads();
    const run = vi.fn<NonNullable<CodexCliOptions['run']>>()
      .mockResolvedValueOnce(message(action)).mockResolvedValueOnce(message('{"actions":[],"content":"a.pdf, b.txt"}'));
    const c = client(run, { threads: store });
    const first = await c.send(params);
    const final = await c.submitToolOutputs(first.thread_id!, [{ tool_call_id: first.tool_calls![0]!.id, output: '["a.pdf","b.txt"]' }]);
    expect(final).toMatchObject({ status: 'COMPLETED', content: 'a.pdf, b.txt', thread_id: first.thread_id });
    const [args, stdin] = run.mock.calls[1]!;
    expect(args).toContain('--output-schema');
    expect(stdin).toContain('fs_list');
    expect(stdin).toContain('["a.pdf","b.txt"]');
    expect(stdin).toContain('You are Chip.');
    expect(store.get(first.thread_id!).map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
  });

  it('propagates caller cancellation, pre-cancellation and timeout to the runner', async () => {
    const run: NonNullable<CodexCliOptions['run']> = async (_args, _stdin, { signal }) => new Promise((_resolve, reject) => {
      const abort = () => reject(new Error('codex: timed out or cancelled'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    await expect(client(run, { timeoutMs: 5 }).send(params)).rejects.toThrow('codex: timed out or cancelled');
    const controller = new AbortController();
    const pending = client(run).send({ ...params, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('codex: timed out or cancelled');
    await expect(client(run).send({ ...params, signal: controller.signal })).rejects.toThrow('codex: timed out or cancelled');
  });
});

describe('Codex native process boundary', () => {
  function processMock(reply: (child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) => void) {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: vi.fn(() => queueMicrotask(() => reply(child))) }),
      kill: vi.fn(),
    });
    return child;
  }

  it('spawns without a shell and returns agent output', async () => {
    const child = processMock(c => { c.stdout.emit('data', message('hello')); c.emit('close', 0); });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    expect(await new CodexCliClient({ threads: threads() }).send({ ...params, tools: [] })).toMatchObject({ status: 'COMPLETED', content: 'hello' });
    expect(vi.mocked(spawn).mock.calls.at(-1)![2]).toMatchObject({ shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(child.stdin.end).toHaveBeenCalledWith(expect.stringContaining('INSTRUCTIONS:'));
  });

  it('provides install guidance for spawn errors and surfaces nonzero exits', async () => {
    const missing = processMock(c => c.emit('error', new Error('ENOENT')));
    vi.mocked(spawn).mockReturnValueOnce(missing as unknown as ReturnType<typeof spawn>);
    await expect(new CodexCliClient({ threads: threads() }).send(params)).rejects.toThrow('codex: ENOENT (is Codex installed? npm i -g @openai/codex)');
    const failed = processMock(c => { c.stderr.emit('data', 'process failed'); c.emit('close', 2); });
    vi.mocked(spawn).mockReturnValueOnce(failed as unknown as ReturnType<typeof spawn>);
    await expect(new CodexCliClient({ threads: threads() }).send(params)).rejects.toThrow('codex: process failed');
  });

  it('kills a running process on timeout and never spawns an already cancelled turn', async () => {
    const child = processMock(() => {});
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    await expect(new CodexCliClient({ threads: threads(), timeoutMs: 5 }).send(params)).rejects.toThrow('codex: timed out or cancelled');
    expect(child.kill).toHaveBeenCalledOnce();
    const count = vi.mocked(spawn).mock.calls.length;
    const controller = new AbortController(); controller.abort();
    await expect(new CodexCliClient({ threads: threads() }).send({ ...params, signal: controller.signal })).rejects.toThrow('codex: timed out or cancelled');
    expect(vi.mocked(spawn).mock.calls).toHaveLength(count);
  });
});

describe('shared Claude helpers preserve its client behavior', () => {
  it('keeps Claude action decisions, filtering and continuation unchanged', async () => {
    const run = vi.fn().mockResolvedValueOnce(JSON.stringify({ structured_output: JSON.parse(action) }))
      .mockResolvedValueOnce(JSON.stringify({ structured_output: { actions: [{ action: 'unknown', input: '{}' }], content: 'done' } }));
    const c = new ClaudeCliClient({ threads: threads(), run });
    const first = await c.send(params);
    expect(first).toMatchObject({ status: 'REQUIRES_ACTION', model_provider: 'anthropic', tool_calls: [{ function: { name: 'fs_list' } }] });
    expect(await c.submitToolOutputs(first.thread_id!, [{ tool_call_id: first.tool_calls![0]!.id, output: '[]' }])).toMatchObject({ status: 'COMPLETED', content: 'done' });
    expect(run.mock.calls[1]![0]).toContain('--json-schema');
  });
});
