/**
 * The brain is the AI the user already has: this LlmClient runs the Claude Code CLI installed on the
 * machine (`claude -p`), signed in with the user's own plan. No Backboard account. Each call is a fresh
 * headless process (no shell; the prompt goes in on stdin); the conversation lives in ADE's own threads
 * table (ade.db), so nothing is kept by the vendor. Tools are offered as JSON in the prompt and come back
 * as a structured decision (tool_calls or content), which the rest of ADE sees in the same shape as a
 * Backboard reply.
 *
 * Switch: ADE_BRAIN=claude-cli in .env (dev) or the environment. Default stays Backboard until this passes
 * the demo path. Codex and Gemini follow the same contract later.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { LlmClient, LlmResponse, LlmToolCall, OpenAiTool, SendParams } from '../runtime/types';

type ModelChoice = NonNullable<SendParams['model']>;
import type { ThreadMessage, ThreadStore } from '../store/localThreads';

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      description: 'Actions for the application to perform now. Empty when you answer instead.',
      items: {
        type: 'object',
        properties: { action: { type: 'string' }, input: { type: 'string', description: 'The input for that action as a JSON object, encoded as a string.' } },
        required: ['action', 'input'],
      },
    },
    content: { type: 'string', description: 'Your answer when no action is needed, in the format the instructions ask for.' },
  },
};

const CONTEXT_BUDGET_TOKENS = 24_000;
const DEFAULT_TIMEOUT_MS = 90_000;

export interface ClaudeCliOptions {
  threads: ThreadStore;
  /** Path to the claude executable. Default: `claude` on PATH. */
  bin?: string;
  /** Working directory for the process; a neutral folder, never the user's project. */
  cwd?: string;
  timeoutMs?: number;
  /** Test seam: runs the process. Default spawns the real CLI. */
  run?: (args: string[], stdin: string, opts: { cwd?: string; signal: AbortSignal }) => Promise<string>;
}

export class ClaudeCliClient implements LlmClient {
  private readonly run: NonNullable<ClaudeCliOptions['run']>;
  /** Per thread: the tools and flags of the last send(), so a tool-output turn offers the same tools. */
  private readonly pending = new Map<string, Pick<SendParams, 'tools' | 'systemPrompt' | 'webSearch' | 'jsonOutput' | 'timeoutMs'>>();

  constructor(private readonly o: ClaudeCliOptions) { this.run = o.run ?? ((args, stdin, opts) => spawnClaude(o.bin ?? 'claude', args, stdin, opts)); }

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
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--exclude-dynamic-system-prompt-sections', '--strict-mcp-config',
      '--tools', p.webSearch === 'Auto' ? 'WebSearch,WebFetch' : '',
      '--system-prompt', system + (structured ? `\n\n${TOOL_RULES}` : p.jsonOutput ? '\n\nReply with the JSON only, no prose and no code fences.' : '')];
    if (structured) args.push('--json-schema', JSON.stringify(DECISION_SCHEMA));
    if (p.model?.llm_provider === 'anthropic' && p.model.model_name) args.push('--model', p.model.model_name);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), p.timeoutMs ?? this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    p.signal?.addEventListener('abort', onAbort, { once: true });
    let raw: string;
    try { raw = await this.run(args, prompt, { cwd: this.o.cwd, signal: controller.signal }); }
    finally { clearTimeout(timeout); p.signal?.removeEventListener('abort', onAbort); }
    const result = parseResult(raw);
    if (result.is_error) throw new Error(`claude: ${result.text || 'failed'}`);
    const decision = structured ? decisionFrom(result) : null;
    const now = Date.now();
    if (decision?.tool_calls?.length) {
      const calls: LlmToolCall[] = decision.tool_calls
        .filter((c) => tools.some((t) => t.function.name === c.name))
        .map((c) => ({ id: `call_${randomUUID().slice(0, 8)}`, type: 'function' as const, function: { name: c.name, arguments: normalizeArgs(c.arguments) } }));
      if (calls.length) {
        this.o.threads.append(threadId, [{ role: 'assistant', content: decision.content ?? '', toolCalls: calls, ts: now }]);
        return { status: 'REQUIRES_ACTION', thread_id: threadId, content: decision.content ?? null, tool_calls: calls, model_provider: 'anthropic', model_name: result.model ?? null };
      }
    }
    const content = decision ? (decision.content ?? '') : result.text;
    this.o.threads.append(threadId, [{ role: 'assistant', content, ts: now }]);
    return { status: 'COMPLETED', thread_id: threadId, content, tool_calls: null, model_provider: 'anthropic', model_name: result.model ?? null };
  }
}

export const TOOL_RULES = `You are the reasoning engine inside a desktop application. In this session you have NO tools of your own: nothing to call or invoke, no files, no shell, no agents. Never attempt to invoke anything.
The application can perform the ACTIONS listed in the message, on your request. Your whole reply is one JSON object:
- To request actions: "actions", a list of {"action": its name, "input": the input as a JSON object encoded as a string}. Use only listed actions with the listed inputs; several at once is fine. The application performs them and sends each result back as ACTION RESULT.
- To answer the person: "content", written exactly in the format your instructions ask for.
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

function parseResult(raw: string): { is_error: boolean; text: string; structured?: unknown; model?: string } {
  const line = raw.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{')) ?? raw.trim();
  let j: Record<string, unknown>;
  try { j = JSON.parse(line); } catch { return { is_error: true, text: raw.trim().slice(0, 300) || 'no output' }; }
  const usage = j.modelUsage && typeof j.modelUsage === 'object' ? Object.keys(j.modelUsage as object) : [];
  return { is_error: !!j.is_error, text: typeof j.result === 'string' ? j.result : '', structured: j.structured_output, ...(usage[0] ? { model: usage[0] } : {}) };
}

export function decisionFrom(r: { text: string; structured?: unknown }): { tool_calls?: { name: string; arguments: string }[]; content?: string } | null {
  // Safety net: the model sometimes tries a native call anyway; with no tools enabled it leaks as <invoke> text. Read it as the action.
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
  const re = /<invoke name="([^"]+)">([\s\S]*?)(?:<\/invoke>|$)/g;
  for (const m of text.matchAll(re)) {
    const args: Record<string, unknown> = {};
    for (const p of m[2]!.matchAll(/<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g)) { const v = p[2]!.trim(); args[p[1]!] = tryJson(v) ?? v; }
    out.push({ name: m[1]!, arguments: JSON.stringify(args) });
  }
  return out;
}

export const tryJson = (s: string): unknown => { try { return JSON.parse(s.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return undefined; } };
export const normalizeArgs = (s: string): string => { const v = tryJson(s); return v && typeof v === 'object' ? JSON.stringify(v) : '{}'; };

/** Runs the claude executable directly (no shell) with the prompt on stdin. */
function spawnClaude(bin: string, args: string[], stdin: string, opts: { cwd?: string; signal: AbortSignal }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const kill = () => { child.kill(); reject(new Error('claude: timed out or cancelled')); };
    opts.signal.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => { opts.signal.removeEventListener('abort', kill); reject(new Error(`claude: ${e.message} (is Claude Code installed and on PATH?)`)); });
    child.on('close', (code) => {
      opts.signal.removeEventListener('abort', kill);
      if (out.trim()) resolve(out); else reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300) || 'no output'}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}
