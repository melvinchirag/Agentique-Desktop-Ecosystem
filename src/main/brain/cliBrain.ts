/**
 * One LlmClient for every CLI brain (Claude Code, Codex, Gemini): the AI the user already has, driven
 * through its installed command-line tool. Each call is a fresh headless process (no shell; prompt on
 * stdin). The conversation lives in ADE's own threads table (ade.db), never with the vendor. ADE's tools
 * are offered as plain-English actions and come back as a structured decision (actions or content), which
 * the rest of ADE sees in the same shape as a Backboard reply.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmClient, LlmResponse, LlmToolCall, OpenAiTool, SendParams } from '../runtime/types';
import type { ThreadMessage, ThreadStore } from '../store/localThreads';
import { DECISION_SCHEMA, type BrainVendor } from './vendors';

type ModelChoice = NonNullable<SendParams['model']>;

const CONTEXT_BUDGET_TOKENS = 24_000;
const DEFAULT_TIMEOUT_MS = 90_000;

export interface CliBrainOptions {
  threads: ThreadStore;
  /** Path to the executable when it is not on PATH (ADE_CLAUDE_BIN / ADE_CODEX_BIN / ADE_GEMINI_BIN). */
  bin?: string;
  /** A neutral working folder for the vendor process; never the user's project. */
  workDir: string;
  timeoutMs?: number;
  /** Test seam: runs the process. Default spawns the real CLI. */
  run?: (bin: string, args: string[], stdin: string, opts: { cwd: string; signal: AbortSignal }) => Promise<{ stdout: string; code: number | null }>;
}

export class CliBrainClient implements LlmClient {
  private readonly run: NonNullable<CliBrainOptions['run']>;
  private readonly workDir: string;
  private readonly schemaFile: string;
  /** Per thread: the tools and flags of the last send(), so a tool-output turn offers the same tools. */
  private readonly pending = new Map<string, Pick<SendParams, 'tools' | 'systemPrompt' | 'webSearch' | 'jsonOutput' | 'timeoutMs'>>();

  constructor(private readonly vendor: BrainVendor, private readonly o: CliBrainOptions) {
    this.run = o.run ?? spawnCli;
    this.workDir = join(o.workDir, 'brain', vendor.id);
    mkdirSync(this.workDir, { recursive: true });
    this.schemaFile = join(this.workDir, 'decision-schema.json');
    writeFileSync(this.schemaFile, JSON.stringify(DECISION_SCHEMA));
  }

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
    const systemBase = window.find((m) => m.role === 'system')?.content ?? p.systemPrompt ?? '';
    const tools = p.tools ?? [];
    const structured = !p.jsonOutput && tools.length > 0;
    const system = systemBase + (structured ? `\n\n${ACTION_RULES}` : p.jsonOutput ? '\n\nReply with the JSON only, no prose and no code fences.' : '');
    const prompt = renderTranscript(window.filter((m) => m.role !== 'system'), tools, structured);
    const resultFile = join(this.workDir, `result-${randomUUID()}.txt`);
    const { args, stdin } = this.vendor.invoke({
      system, prompt, structured, webSearch: p.webSearch === 'Auto', workDir: this.workDir, schemaFile: this.schemaFile, resultFile,
      ...(p.model?.llm_provider === this.vendor.provider && p.model.model_name ? { model: p.model.model_name } : {}),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), p.timeoutMs ?? this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    p.signal?.addEventListener('abort', onAbort, { once: true });
    let result;
    try {
      const proc = await this.run(this.o.bin ?? this.vendor.bin, args, stdin, { cwd: this.workDir, signal: controller.signal });
      result = this.vendor.parse(proc.stdout, proc.code, existsSync(resultFile) ? resultFile : undefined);
    } finally {
      clearTimeout(timeout); p.signal?.removeEventListener('abort', onAbort);
      try { rmSync(resultFile, { force: true }); } catch { /* best effort */ }
    }
    if (result.is_error) throw new Error(`${this.vendor.name}: ${result.text || 'failed'}`);
    const decision = structured ? decisionFrom(result) : null;
    const now = Date.now();
    if (decision?.tool_calls?.length) {
      const calls: LlmToolCall[] = decision.tool_calls
        .filter((c) => tools.some((t) => t.function.name === c.name))
        .map((c) => ({ id: `call_${randomUUID().slice(0, 8)}`, type: 'function' as const, function: { name: c.name, arguments: normalizeArgs(c.arguments) } }));
      if (calls.length) {
        this.o.threads.append(threadId, [{ role: 'assistant', content: decision.content ?? '', toolCalls: calls, ts: now }]);
        return { status: 'REQUIRES_ACTION', thread_id: threadId, content: decision.content ?? null, tool_calls: calls, model_provider: this.vendor.provider, model_name: result.model ?? null };
      }
    }
    const content = decision ? (decision.content ?? '') : result.text;
    this.o.threads.append(threadId, [{ role: 'assistant', content, ts: now }]);
    return { status: 'COMPLETED', thread_id: threadId, content, tool_calls: null, model_provider: this.vendor.provider, model_name: result.model ?? null };
  }
}

const ACTION_RULES = `You are the reasoning engine inside a desktop application. In this session you have NO tools of your own: nothing to call or invoke, no files, no shell, no agents. Never attempt to invoke anything.
The application can perform the ACTIONS listed in the message, on your request. Your whole reply is one JSON object:
- To request actions: "actions", a list of {"action": its name, "input": the input as a JSON object encoded as a string}. Use only listed actions with the listed inputs; several at once is fine. The application performs them and sends each result back as ACTION RESULT. Leave "content" empty.
- To answer the person: "content", written exactly in the format your instructions ask for. Leave "actions" empty.
Never describe an action in prose; never invent results; after an ACTION RESULT, continue the job or answer.`;

/** One action per line, in words, so the model does not read it as a native tool it could invoke. */
function describeAction(t: OpenAiTool): string {
  const params = t.function.parameters as { properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>; required?: string[] } | undefined;
  const required = new Set(params?.required ?? []);
  const inputs = Object.entries(params?.properties ?? {}).map(([k, v]) =>
    `${k} (${v.type ?? 'any'}${required.has(k) ? ', required' : ''}${v.enum ? `, one of ${JSON.stringify(v.enum)}` : ''})${v.description ? `: ${v.description}` : ''}`);
  return `- ${t.function.name}: ${t.function.description}${inputs.length ? `\n    input: ${inputs.join('; ')}` : '\n    input: none'}`;
}

export function renderTranscript(messages: ThreadMessage[], tools: OpenAiTool[], structured: boolean): string {
  const parts: string[] = [];
  if (structured) parts.push(`ACTIONS the application can perform for you:\n${tools.map(describeAction).join('\n')}`);
  parts.push('CONVERSATION:');
  for (const m of messages) {
    if (m.role === 'user') parts.push(`USER:\n${m.content}`);
    else if (m.role === 'assistant') {
      if (m.toolCalls?.length) parts.push(`YOU requested actions:\n${m.toolCalls.map((c) => `- ${c.function.name} ${c.function.arguments}`).join('\n')}`);
      if (m.content) parts.push(`YOU:\n${m.content}`);
    } else if (m.role === 'tool') parts.push(`ACTION RESULT (${m.toolCallId ?? 'action'}):\n${m.content}`);
  }
  parts.push(structured ? 'Now reply with the JSON object: actions, or content.' : 'Now answer.');
  return parts.join('\n\n');
}

export function decisionFrom(r: { text: string; structured?: unknown }): { tool_calls?: { name: string; arguments: string }[]; content?: string } | null {
  // Safety net: a model sometimes tries a native call anyway; with no tools enabled it leaks as <invoke> text. Read it as the action.
  const leaked = parseInvokeXml(r.text);
  if (leaked.length) return { tool_calls: leaked };
  const candidate = r.structured ?? tryJson(r.text);
  if (!candidate || typeof candidate !== 'object') return r.text ? { content: r.text } : null;
  const d = candidate as { actions?: unknown; tool_calls?: unknown; content?: unknown };
  const list = Array.isArray(d.actions) ? d.actions : Array.isArray(d.tool_calls) ? d.tool_calls : [];
  const calls = list.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({ name: String(c.action ?? c.name ?? ''), raw: c.input ?? c.arguments }))
    .filter((c) => c.name)
    .map((c) => ({ name: c.name, arguments: typeof c.raw === 'string' ? c.raw : JSON.stringify(c.raw ?? {}) }));
  return { ...(calls.length ? { tool_calls: calls } : {}), ...(typeof d.content === 'string' ? { content: d.content } : {}) };
}

function parseInvokeXml(text: string): { name: string; arguments: string }[] {
  const out: { name: string; arguments: string }[] = [];
  for (const m of text.matchAll(/<invoke name="([^"]+)">([\s\S]*?)(?:<\/invoke>|$)/g)) {
    const args: Record<string, unknown> = {};
    for (const p of m[2]!.matchAll(/<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g)) { const v = p[2]!.trim(); args[p[1]!] = tryJson(v) ?? v; }
    out.push({ name: m[1]!, arguments: JSON.stringify(args) });
  }
  return out;
}

const tryJson = (s: string): unknown => { try { return JSON.parse(s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return undefined; } };
const normalizeArgs = (s: string): string => { const v = tryJson(s); return v && typeof v === 'object' ? JSON.stringify(v) : '{}'; };

/** Runs the executable directly (no shell) with the prompt on stdin. */
function spawnCli(bin: string, args: string[], stdin: string, opts: { cwd: string; signal: AbortSignal }): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const kill = () => { child.kill(); reject(new Error('timed out or cancelled')); };
    opts.signal.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => { opts.signal.removeEventListener('abort', kill); reject(new Error(`${e.message} (is it installed and on PATH?)`)); });
    child.on('close', (code) => {
      opts.signal.removeEventListener('abort', kill);
      if (out.trim() || code === 0) resolve({ stdout: out || err, code }); else reject(new Error(`exited ${code}: ${err.trim().slice(0, 300) || 'no output'}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}
