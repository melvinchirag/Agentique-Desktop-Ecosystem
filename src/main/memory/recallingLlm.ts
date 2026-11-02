/**
 * RecallingLlm: puts local memory in front of any LlmClient, so memory no longer lives on the model vendor.
 *
 * On every `send` whose memory mode is Auto or Readonly (Chip's user turns, specialist jobs), it
 * recalls the agent's relevant memories from the local store, prepends them as a short [memories]
 * block, forwards the turn with memory 'off' (the vendor stores nothing), and reports the recalled
 * texts as `retrieved_memories` so the orchestrator keeps emitting `agent.recall` unchanged.
 *
 * After an Auto turn it extracts new durable facts with one extra model call that uses the animal's
 * own memory rules (agents/<animal>/memory-rules.ts, wrapped by sponsors/memoryFormat.ts), never
 * blocking the reply, serialized per animal, never throwing. Warden is never recalled or extracted.
 */
import type { AgentId, ModelChoice } from '../../shared/agents';
import { DEFAULT_RECALL_K, recallHits, recallTerms, type RecallProvider } from '../runtime/recall';
import type { LlmClient, LlmResponse, MemoryWriter, SendParams, Memory } from '../runtime/types';
import { withFactFormat } from '../sponsors/memoryFormat';
import { MEMORY_RULES } from './rules';

export interface RecallingLlmDeps {
  inner: LlmClient;
  recall: RecallProvider;
  writer: MemoryWriter & { list(agentId: AgentId): Promise<Memory[]> };
  /** Which animal a Backboard assistant id belongs to; undefined for ids that are not animals. */
  agentFor: (assistantId: string) => AgentId | undefined;
  /** Default true. Set false to recall without learning (tests, demo rehearsals). */
  extract?: boolean;
  k?: number;
  onError?: (agentId: AgentId, error: unknown) => void;
}

const MEMORIES_OPEN = '[memories]';
const MEMORIES_CLOSE = '[/memories]';

export function formatMemoriesBlock(memories: Memory[]): string {
  return `${MEMORIES_OPEN}\n${memories.map((m) => `- ${m.content}`).join('\n')}\n${MEMORIES_CLOSE}`;
}

/** Parses {"facts": [...]} from a model reply, tolerating code fences and surrounding prose. Never throws. */
export function parseFacts(text: string | null | undefined): string[] {
  if (!text) return [];
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return [];
    return [...new Set(parsed.facts.filter((f): f is string => typeof f === 'string').map((f) => f.trim()).filter((f) => f.length > 0 && f.length <= 300))];
  } catch { return []; }
}

export class RecallingLlm implements LlmClient {
  private readonly chains = new Map<AgentId, Promise<void>>();
  constructor(private readonly deps: RecallingLlmDeps) {}

  async send(p: SendParams): Promise<LlmResponse> {
    const agent = this.deps.agentFor(p.assistantId);
    const mode = p.memory ?? 'off';
    if (!agent || agent === 'wolf' || mode === 'off') return this.deps.inner.send(p);

    const memories = await this.safeRecall(agent, p.content);
    const content = memories.length ? `${formatMemoriesBlock(memories)}\n\n${p.content}` : p.content;
    const res = await this.deps.inner.send({ ...p, content, memory: 'off' });
    if (mode === 'Auto' && (this.deps.extract ?? true)) this.queueExtraction(agent, p);
    return memories.length ? { ...res, retrieved_memories: memories.map((m) => m.content) } : res;
  }

  submitToolOutputs(threadId: string, outputs: { tool_call_id: string; output: string }[], signal?: AbortSignal, model?: ModelChoice): Promise<LlmResponse> {
    return this.deps.inner.submitToolOutputs(threadId, outputs, signal, model);
  }

  /** Resolves when every queued extraction has finished (tests and clean shutdown). */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  /**
   * Only memories that share a word with the message reach the turn. RecallProvider fills up with
   * recent rows, which is right for a "what do you know" view but would put unrelated facts in every
   * prompt and fire the Hub's "Remembered" sparkle on every turn; Backboard returned relevant ones only.
   */
  private async safeRecall(agent: AgentId, text: string): Promise<Memory[]> {
    try {
      const terms = recallTerms(text);
      const rows = await this.deps.recall.recall(agent, text, this.deps.k ?? DEFAULT_RECALL_K);
      return rows.filter((m) => recallHits(m.content, terms) > 0);
    } catch (e) { this.deps.onError?.(agent, e); return []; }
  }

  private queueExtraction(agent: AgentId, p: SendParams): void {
    const rules = MEMORY_RULES[agent];
    if (!rules) return;
    const prev = this.chains.get(agent) ?? Promise.resolve();
    const next = prev.then(() => this.extract(agent, p, rules.extraction, rules.example)).catch((e) => this.deps.onError?.(agent, e));
    this.chains.set(agent, next);
  }

  private async extract(agent: AgentId, p: SendParams, extraction: string, example: { input: string; facts: string[] }): Promise<void> {
    const res = await this.deps.inner.send({
      assistantId: p.assistantId, content: p.content, model: p.model,
      systemPrompt: withFactFormat(extraction, example),
      tools: [], memory: 'off', webSearch: 'off', jsonOutput: true, timeoutMs: 20_000,
    });
    const facts = parseFacts(res.content);
    if (facts.length === 0) return;
    const existing = new Set((await this.deps.writer.list(agent)).map((m) => m.content.trim().toLowerCase()));
    for (const fact of facts) {
      const key = fact.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      await this.deps.writer.add(agent, fact);
    }
  }
}
