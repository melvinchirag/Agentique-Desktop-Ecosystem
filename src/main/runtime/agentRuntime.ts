import { AGENTS } from '../../shared/config';
import type { AdeSettings } from '../../shared/ipc';
import type { AgentDefinition, ToolContext, ToolDefinition } from '../../shared/tools';
import type {
  AgentResult, Approvals, Bus, InjectionScreen, JobScheduler, LlmClient, LlmResponse, LlmToolCall,
  OpenAiTool, SpecialistId, SpecialistRunner, SpecialistRunContext, WardenGate,
} from './types';
import { parseSpecialistOutput } from './specialistOutput';

export const SPECIALIST_TOOL_OUTPUT_MAX_CHARS = 12_000;
const DEFAULT_MAX_TOOL_ROUNDS = 8;

export interface RegisteredSpecialist {
  definition: AgentDefinition;
  assistantId: string;
  memory?: { normal: 'Auto' | 'Readonly' | 'off'; help: 'Auto' | 'Readonly' | 'off' };
}

export interface AgentRuntimeDeps {
  bus: Bus;
  llm: LlmClient;
  jobs: JobScheduler;
  gate?: WardenGate;
  approvals: Approvals;
  settings: () => AdeSettings;
  agents: RegisteredSpecialist[];
  /** Warden's result screen, when wired, checks results before Chip or a teammate receives them. */
  screen?: InjectionScreen;
}

function isSpecialist(id: string): id is SpecialistId {
  return id in AGENTS && id !== 'chipmunk' && id !== 'wolf';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function output(value: unknown): string {
  let serialized = JSON.stringify(value ?? null);
  if (serialized.length <= SPECIALIST_TOOL_OUTPUT_MAX_CHARS) return serialized;
  let lo = 0;
  let hi = serialized.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (JSON.stringify({ truncated: true, output: serialized.slice(0, mid) }).length <= SPECIALIST_TOOL_OUTPUT_MAX_CHARS) lo = mid;
    else hi = mid - 1;
  }
  serialized = JSON.stringify({ truncated: true, output: serialized.slice(0, lo) });
  return serialized;
}

/** Exclude content and credentials from the audit event; the tool itself still receives full arguments. */
function auditArgs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(auditArgs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, /body|content|text|token|secret|password|key/i.test(key) ? '[redacted]' : auditArgs(item)]));
  }
  return value;
}

export class AgentRuntime implements SpecialistRunner {
  private readonly registry = new Map<SpecialistId, RegisteredSpecialist>();

  constructor(private readonly deps: AgentRuntimeDeps) {
    for (const agent of deps.agents) {
      const id = agent.definition.id;
      if (!isSpecialist(id) || this.registry.has(id) || !agent.assistantId) throw new Error(`Invalid specialist registration: ${id}`);
      const names = new Set<string>();
      for (const tool of agent.definition.tools) {
        if (tool.name === 'ask_teammate' || names.has(tool.name) || tool.risk === 'external') {
          throw new Error(`Invalid tool registration: ${tool.name}`);
        }
        names.add(tool.name);
      }
      this.registry.set(id, agent);
    }
  }

  async run(agentId: SpecialistId, task: string, ctx: SpecialistRunContext): Promise<AgentResult> {
    const entry = this.registry.get(agentId);
    if (!entry) return this.failure(`No specialist registered for ${agentId}.`, []);
    const { definition, assistantId } = entry;
    const artifacts: AgentResult['artifacts'] = [];
    const tools: OpenAiTool[] = definition.tools.map((tool) => ({
      type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    // Swarm plans only: it never hands work to another animal.
    if (ctx.kind === 'normal' && agentId !== 'ants') tools.push(this.helpTool(agentId));
    const memory = entry.memory?.[ctx.kind] ?? (ctx.kind === 'help' ? 'Readonly' : 'Auto');
    const maxRounds = definition.maxToolRounds > 0 ? definition.maxToolRounds : DEFAULT_MAX_TOOL_ROUNDS;

    try {
      if (ctx.signal.aborted) throw new Error('Aborted');
      // No threadId on this send: each job gets a new Backboard thread.
      let response = await this.retry(() => this.deps.llm.send({
        assistantId, content: task, systemPrompt: definition.systemPrompt, tools,
        model: this.deps.settings().models[agentId], memory,
        webSearch: definition.webSearch ? 'Auto' : 'off', signal: ctx.signal,
      }), ctx.signal);
      let rounds = 0;
      while (response.status === 'REQUIRES_ACTION') {
        if (rounds++ >= maxRounds) return this.failure('Tool round limit reached.', artifacts);
        if (!response.thread_id || !response.tool_calls?.length) return this.failure('Backboard returned no tool calls or thread.', artifacts);
        const threadId = response.thread_id;
        const outputs = await Promise.all(response.tool_calls.map(async (call) => ({
          tool_call_id: call.id,
          output: await this.execute(agentId, definition, call, ctx, threadId, artifacts),
        })));
        response = await this.retry(() => this.deps.llm.submitToolOutputs(threadId, outputs, ctx.signal, this.deps.settings().models[agentId]), ctx.signal);
      }
      if (response.status !== 'COMPLETED') return this.failure(`Backboard ${response.status ?? 'did not complete'}.`, artifacts);
      const parsed = parseSpecialistOutput(response.content, AGENTS[agentId].displayName);
      if (!parsed.summary) return this.failure('Backboard completed without an answer.', artifacts);
      if (this.deps.screen) {
        const source = { kind: 'summary' as const, name: AGENTS[agentId].displayName, taskId: ctx.taskId, jobId: ctx.jobId };
        const say = await this.deps.screen.screen(parsed.say, source);
        const bubble = await this.deps.screen.screen(parsed.bubble, source);
        const summary = await this.deps.screen.screen(parsed.summary, source);
        if (say.flagged || bubble.flagged || summary.flagged) {
          parsed.say = 'Done, but Warden flagged something in it.';
          parsed.bubble = 'Review needed';
        }
        parsed.summary = summary.wrapped;
      }
      return { ok: true, ...parsed, artifacts };
    } catch (error) {
      // A failed screen must never leak an unchecked model instruction through the result.
      return this.deps.screen
        ? { ok: false, say: 'Done, but Warden flagged something in it.', bubble: 'Review needed', summary: 'Result could not be screened.', artifacts }
        : this.failure(errorText(error), artifacts);
    }
  }

  private failure(reason: string, artifacts: AgentResult['artifacts']): AgentResult {
    return { ok: false, say: 'Hit a snag.', bubble: 'Snag', summary: reason, artifacts };
  }

  private async retry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      return operation();
    }
  }

  private helpTool(agentId: SpecialistId): OpenAiTool {
    const installed = this.deps.settings().installed;
    const ids = [...this.registry.keys()].filter((id) => id !== agentId && installed[id]);
    return { type: 'function', function: {
      name: 'ask_teammate',
      description: 'Ask another animal for something specific you need to finish your job. Waits for the answer.',
      parameters: { type: 'object', properties: { agent: { type: 'string', enum: ids }, request: { type: 'string' } }, required: ['agent', 'request'] },
    } };
  }

  private async execute(
    agentId: SpecialistId, def: AgentDefinition, call: LlmToolCall, ctx: SpecialistRunContext,
    threadId: string, artifacts: AgentResult['artifacts'],
  ): Promise<string> {
    const { bus, gate, approvals, jobs } = this.deps;
    const tool = def.tools.find((candidate) => candidate.name === call.function.name);
    const help = call.function.name === 'ask_teammate' && ctx.kind === 'normal' && agentId !== 'ants';
    if (call.function.name === 'ask_teammate' && !help) return output({ error: 'UNKNOWN_TOOL' });
    let args: unknown;
    try { args = JSON.parse(call.function.arguments); }
    catch { return output({ error: 'INVALID_ARGUMENTS' }); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return output({ error: 'INVALID_ARGUMENTS' });
    const input = args as Record<string, unknown>;
    if (help) {
      const teammate = input.agent;
      if (typeof teammate !== 'string' || !isSpecialist(teammate) || teammate === agentId ||
          typeof input.request !== 'string' || !input.request.trim() ||
          !this.registry.has(teammate) || !this.deps.settings().installed[teammate]) return output({ error: 'INVALID_TEAMMATE' });
      const submitted = jobs.submit({ agent: teammate, task: input.request, title: input.request.trim().split(/\s+/).slice(0, 5).join(' '),
        requestedBy: agentId, kind: 'help', parentTaskId: ctx.taskId });
      if (!submitted.jobId) return output({ error: submitted.status.toUpperCase() });
      try {
        const result = await jobs.waitFor(submitted.jobId);
        return output({ ok: result.ok, summary: result.summary });
      } catch (error) { return output({ error: errorText(error) }); }
    }
    const selected = tool as ToolDefinition | undefined;
    let risk = selected?.risk ?? (call.function.name.split('_').some((part) =>
      ['send', 'forward', 'post', 'publish', 'share', 'purchase', 'pay', 'transfer', 'invite'].includes(part)) ? 'external' : 'read');
    try { if (selected?.riskFor) risk = this.higherRisk(risk, selected.riskFor(input)); }
    catch { risk = 'destructive'; }
    bus.emit({ type: 'tool.request', agentId, taskId: ctx.taskId, callId: call.id,
      tool: call.function.name, args: auditArgs(input), risk });
    const finish = (ok: boolean, summary: string, result: unknown): string => {
      bus.emit({ type: 'tool.result', agentId, taskId: ctx.taskId, callId: call.id, ok, summary });
      return output(result);
    };
    // Local async preflight gives synchronous Warden inspection authoritative
    // journal metadata (notably for undo immediately after an app restart).
    if (selected && 'prepareInspection' in selected) {
      try {
        await (selected as ToolDefinition & { prepareInspection: (args: Record<string, unknown>) => Promise<void> }).prepareInspection(input);
      } catch {
        const reason = 'The safety check failed, so this action was blocked.';
        bus.emit({ type: 'wolf.alert', agentId: 'wolf', taskId: ctx.taskId, source: 'gate', reason });
        bus.emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: ctx.taskId,
          callId: call.id, verdict: 'deny', rule: 'W0', reason });
        return finish(false, 'Blocked by Warden (W0)', { error: 'DENIED_BY_WOLF', rule: 'W0', reason });
      }
    }
    let verdict: 'allow' | 'ask' | 'deny';
    try {
      verdict = gate?.review({ agentId, taskId: ctx.taskId, callId: call.id, tool: call.function.name,
        risk, jobId: ctx.jobId, jobKind: ctx.kind, args: input }) ?? (risk === 'read' ? 'allow' : 'deny');
    } catch {
      verdict = 'deny';
    }
    if (verdict === 'deny') {
      const detail = gate?.explain?.(call.id);
      return finish(false, `Blocked by Warden${detail?.rule ? ` (${detail.rule})` : ''}`,
        { error: 'DENIED_BY_WOLF', ...detail });
    }
    if (!tool && !help) return finish(false, 'Unknown tool.', { error: 'UNKNOWN_TOOL' });
    if (verdict === 'ask') {
      const askingJob = ctx.kind === 'help' ? jobs.list().find((job) =>
        job.kind === 'normal' && job.agent === jobs.list().find((current) => current.jobId === ctx.jobId)?.requestedBy
        && job.parentTaskId === ctx.taskId && job.state === 'running') : undefined;
      const title = askingJob
        ? `${AGENTS[agentId].displayName} (helping ${AGENTS[askingJob.agent].displayName}) needs your OK`
        : `${AGENTS[agentId].displayName} needs your OK`;
      const decision = await approvals.request({ callId: call.id, jobId: ctx.jobId, taskId: ctx.taskId,
        agentId, title, preview: selected?.preview?.(input) ?? selected?.description ?? 'Ask a teammate', signal: ctx.signal });
      if (!decision.approved) return finish(false, 'User declined.', { error: 'USER_DECLINED' });
    }
    if (!selected) return finish(false, 'Unknown tool.', { error: 'UNKNOWN_TOOL' });
    try {
      if (ctx.signal.aborted) return finish(false, 'Cancelled.', { error: 'CANCELLED' });
      const toolCtx: ToolContext = {
        agentId, taskId: ctx.taskId, jobId: ctx.jobId, sessionId: bus.sessionId, threadId, signal: ctx.signal,
        emit: (event) => {
          if (event.type === 'artifact') artifacts.push({ kind: event.kind, title: event.title });
          bus.emit(event);
        },
      };
      const value = await selected.execute(input, toolCtx);
      return finish(true, `${selected.name} completed.`, value);
    } catch (error) {
      return finish(false, `${selected.name} failed.`, { error: errorText(error) });
    }
  }

  private higherRisk(a: ToolDefinition['risk'], b: ToolDefinition['risk']): ToolDefinition['risk'] {
    const order: ToolDefinition['risk'][] = ['read', 'draft', 'write', 'destructive', 'external'];
    return order[Math.max(order.indexOf(a), order.indexOf(b))];
  }
}

export function createAgentRuntime(deps: AgentRuntimeDeps): SpecialistRunner {
  return new AgentRuntime(deps);
}
