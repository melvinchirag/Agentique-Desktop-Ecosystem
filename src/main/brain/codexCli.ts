/** Codex CLI reasoning with ADE-owned threads and Warden-owned application actions. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmClient, LlmResponse, LlmToolCall, SendParams } from '../runtime/types';
import type { ThreadStore } from '../store/localThreads';
import { TOOL_RULES, renderTranscript, decisionFrom, normalizeArgs, tryJson } from './claudeCli';
import { resolveCodexBin } from './detect';

type ModelChoice = NonNullable<SendParams['model']>;
const CONTEXT_BUDGET_TOKENS = 24_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    actions: { type: 'array', items: {
      type: 'object', properties: { action: { type: 'string' }, input: { type: 'string' } },
      required: ['action', 'input'], additionalProperties: false,
    } },
    content: { type: 'string' },
  },
  required: ['actions', 'content'], additionalProperties: false,
};

export interface CodexCliOptions {
  threads: ThreadStore;
  /** Native executable; Windows npm shims are resolved without a shell. */
  bin?: string;
  /** Kept for parity with Claude's options; Codex always runs in a fresh empty temp folder, never next to the .env. */
  cwd?: string;
  model?: string;
  timeoutMs?: number;
  /** Test seam: runs the process. Default spawns the real CLI. */
  run?: (args: string[], stdin: string, opts: { cwd?: string; signal: AbortSignal }) => Promise<string>;
}

export class CodexCliClient implements LlmClient {
  private readonly run: NonNullable<CodexCliOptions['run']>;
  /** Per thread: the tools and flags of the last send(), so a tool-output turn offers the same tools. */
  private readonly pending = new Map<string, Pick<SendParams, 'tools' | 'systemPrompt' | 'webSearch' | 'jsonOutput' | 'timeoutMs'>>();

  constructor(private readonly o: CodexCliOptions) { this.run = o.run ?? ((args, stdin, opts) => spawnCodex(resolveCodexBin(o.bin), args, stdin, opts)); }

  async send(p: SendParams): Promise<LlmResponse> {
    const threads = this.o.threads;
    const threadId = p.threadId ?? threads.create(p.assistantId);
    const now = Date.now();
    if (!p.threadId && p.systemPrompt) threads.append(threadId, [{ role: 'system', content: p.systemPrompt, ts: now }]);
    threads.append(threadId, [{ role: 'user', content: p.content, ts: now }]);
    return this.turn(threadId, p);
  }

  async submitToolOutputs(threadId: string, outputs: { tool_call_id: string; output: string }[], signal?: AbortSignal, model?: ModelChoice): Promise<LlmResponse> {
    const now = Date.now();
    this.o.threads.append(threadId, outputs.map((o) => ({ role: 'tool' as const, content: o.output, toolCallId: o.tool_call_id, ts: now })));
    const pending = this.pending.get(threadId);
    return this.turn(threadId, { assistantId: threadId.split('-')[0]!, content: '', ...(pending ?? {}), signal, model });
  }

  private async turn(threadId: string, p: SendParams): Promise<LlmResponse> {
    this.pending.set(threadId, { tools: p.tools, systemPrompt: p.systemPrompt, webSearch: p.webSearch, jsonOutput: p.jsonOutput, timeoutMs: p.timeoutMs });
    const window = this.o.threads.window(threadId, CONTEXT_BUDGET_TOKENS);
    const system = window.find((m) => m.role === 'system')?.content ?? p.systemPrompt ?? '';
    const tools = p.tools ?? [];
    const structured = !p.jsonOutput && tools.length > 0;
    const prompt = renderTranscript(window.filter((m) => m.role !== 'system'), tools, structured);
    const dir = await mkdtemp(join(tmpdir(), 'ade-codex-'));
    let text: string;
    const model = p.model?.llm_provider === 'openai' && p.model.model_name ? p.model.model_name : this.o.model;
    try {
      const output = join(dir, 'last-message.txt');
      const args = ['exec', '-', '-C', dir, '--skip-git-repo-check', '--ephemeral',
        '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '--disable', 'shell_tool',
        '--disable', 'unified_exec', '-c', 'model_reasoning_effort=low', '-c',
        `web_search=${p.webSearch === 'Auto' ? 'live' : 'disabled'}`, '--json', '-o', output];
      if (structured) {
        const schema = join(dir, 'schema.json');
        await writeFile(schema, JSON.stringify(DECISION_SCHEMA), 'utf8');
        args.push('--output-schema', schema);
      }
      if (model) args.push('-m', model);
      const instructions = system + (structured ? `\n\n${TOOL_RULES}` : p.jsonOutput ? '\n\nReply with the JSON only, no prose and no code fences.' : '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), p.timeoutMs ?? this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      p.signal?.addEventListener('abort', onAbort, { once: true });
      if (p.signal?.aborted) controller.abort();
      let raw: string;
      try { raw = await this.run(args, `INSTRUCTIONS:\n${instructions}\n\n${prompt}`, { cwd: dir, signal: controller.signal }); }
      finally { clearTimeout(timeout); p.signal?.removeEventListener('abort', onAbort); }
      const fallback = parseCodexOutput(raw);
      text = (await readFile(output, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      })).trim() || fallback;
      if (!text.trim()) throw new Error('codex: no output');
    } finally { await rm(dir, { recursive: true, force: true }); }
    const result = { text, model };
    const decision = structured ? decisionFrom(result) : null;
    const now = Date.now();
    if (decision?.tool_calls?.length) {
      const calls: LlmToolCall[] = decision.tool_calls
        .filter((c) => tools.some((t) => t.function.name === c.name))
        .map((c) => ({ id: `call_${randomUUID().slice(0, 8)}`, type: 'function' as const, function: { name: c.name, arguments: normalizeArgs(c.arguments) } }));
      if (calls.length) {
        this.o.threads.append(threadId, [{ role: 'assistant', content: decision.content ?? '', toolCalls: calls, ts: now }]);
        return { status: 'REQUIRES_ACTION', thread_id: threadId, content: decision.content ?? null, tool_calls: calls, model_provider: 'openai', model_name: result.model ?? null };
      }
    }
    const content = decision ? (decision.content ?? '') : result.text;
    this.o.threads.append(threadId, [{ role: 'assistant', content, ts: now }]);
    return { status: 'COMPLETED', thread_id: threadId, content, tool_calls: null, model_provider: 'openai', model_name: result.model ?? null };
  }
}

/** Error events take precedence over even a populated last-message file. */
function parseCodexOutput(raw: string): string {
  let text = '';
  for (const line of raw.split(/\r?\n/)) {
    const event = tryJson(line) as { type?: string; message?: string; error?: { message?: string }; item?: { type?: string; text?: string } } | undefined;
    if (!event) continue;
    if (event.type === 'error' || event.type === 'turn.failed') throw new Error(`codex: ${event.message || event.error?.message || 'failed'}`);
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
  }
  return text;
}

function spawnCodex(bin: string, args: string[], stdin: string, opts: { cwd?: string; signal: AbortSignal }): Promise<string> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) { reject(new Error('codex: timed out or cancelled')); return; }
    const installError = (e: Error) => new Error(`codex: ${e.message} (is Codex installed? npm i -g @openai/codex)`);
    let child: ReturnType<typeof spawn>;
    try { child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { reject(installError(error as Error)); return; }
    let out = '', err = '';
    child.stdout!.on('data', (d) => { out += d; });
    child.stderr!.on('data', (d) => { err += d; });
    const kill = () => { child.kill(); reject(new Error('codex: timed out or cancelled')); };
    opts.signal.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => { opts.signal.removeEventListener('abort', kill); reject(installError(e)); });
    child.on('close', (code) => {
      opts.signal.removeEventListener('abort', kill);
      try {
        parseCodexOutput(out);
        if (code !== 0) throw new Error(`codex: ${err.trim().slice(0, 300) || `exited ${code}`}`);
        resolve(out);
      } catch (error) { reject(error); }
    });
    child.stdin!.on('error', () => {});
    child.stdin!.end(stdin);
  });
}
