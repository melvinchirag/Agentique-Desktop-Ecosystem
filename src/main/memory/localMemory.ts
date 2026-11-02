/**
 * Memories on the user's machine, in the local SQLite file. Replaces Backboard memory.
 *
 * LocalMemoryStore: the same MemoryApi + MemoryWriter the Hub's Memories tab and Pixel's StyleStore use.
 * withLocalMemory: wraps the model client. Before a turn it adds the animal's relevant memories as a short
 * [memories] block and sends with vendor memory off; it reports them as retrieved_memories so the Hub's
 * "Remembered" sparkle works unchanged. After a normal (Auto) turn it learns new facts with one extra call,
 * using each animal's own rules in agents/<animal>/memory-rules.ts. Warden never remembers.
 */
import { randomUUID } from 'node:crypto';
import type { AgentId, ModelChoice } from '../../shared/agents';
import * as ants from '../agents/ants/memory-rules';
import * as beaver from '../agents/beaver/memory-rules';
import * as butterfly from '../agents/butterfly/memory-rules';
import * as chipmunk from '../agents/chipmunk/memory-rules';
import * as eagle from '../agents/eagle/memory-rules';
import * as nightingale from '../agents/nightingale/memory-rules';
import * as workspace from '../agents/workspace/memory-rules';
import type { LlmClient, LlmResponse, Memory, MemoryApi, MemoryWriter, SendParams } from '../runtime/types';
import { withFactFormat, type FactExample } from '../sponsors/memoryFormat';
import type { LocalDb } from '../store/localDb';

const SEARCH_LIMIT = 20;
const RECALL_LIMIT = 5;
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'did', 'does', 'was', 'were', 'are', 'have', 'has', 'had', 'you', 'your', 'our', 'will', 'would', 'can', 'could', 'should', 'just', 'like', 'please', 'tell']);

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
const terms = (text: string): string[] => [...new Set(words(text).filter((w) => !STOPWORDS.has(w)))];
const hits = (content: string, t: string[]): number => { const w = new Set(words(content)); return t.filter((x) => w.has(x)).length; };

type Rules = { FACT_EXTRACTION_PROMPT?: string; FACT_EXAMPLE?: FactExample };
const RULES: Partial<Record<AgentId, Rules>> = { chipmunk, workspace, beaver, eagle, ants, butterfly, nightingale };

export class LocalMemoryStore implements MemoryApi, MemoryWriter {
  constructor(private readonly db: LocalDb, private readonly now: () => number = () => Date.now()) {}

  async list(agentId: AgentId): Promise<Memory[]> {
    return this.db.prepare('SELECT id, content, created_at, updated_at FROM memories WHERE agent_id = ? ORDER BY updated_at DESC, rowid DESC').all(agentId) as unknown as Memory[];
  }

  /** Rows sharing at least one whole word with `q` (common words ignored), most matches first, then newest. */
  async search(agentId: AgentId, q: string, limit = SEARCH_LIMIT): Promise<Memory[]> {
    const t = terms(q);
    if (t.length === 0) return [];
    return (await this.list(agentId)).map((m) => ({ m, n: hits(m.content, t) })).filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n).slice(0, limit).map((x) => x.m);
  }

  async update(agentId: AgentId, id: string, text: string): Promise<void> {
    const r = this.db.prepare('UPDATE memories SET content = ?, updated_at = ? WHERE agent_id = ? AND id = ?').run(text, this.iso(), agentId, id);
    if (r.changes === 0) throw new Error(`No memory "${id}" for ${agentId}`);
  }

  async remove(agentId: AgentId, id: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE agent_id = ? AND id = ?').run(agentId, id);
  }

  async add(agentId: AgentId, text: string): Promise<{ id: string }> {
    const id = randomUUID(), ts = this.iso();
    this.db.prepare('INSERT INTO memories (id, agent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, agentId, text, ts, ts);
    return { id };
  }

  /** Imports exported rows, keeping their ids and dates; skips texts already stored (case-insensitive). */
  async importRows(agentId: AgentId, rows: Memory[]): Promise<{ added: number; skipped: number }> {
    const seen = new Set((await this.list(agentId)).map((m) => m.content.trim().toLowerCase()));
    const insert = this.db.prepare('INSERT OR IGNORE INTO memories (id, agent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    let added = 0, skipped = 0;
    for (const r of rows) {
      const key = r.content.trim().toLowerCase();
      if (!key || seen.has(key)) { skipped++; continue; }
      seen.add(key);
      const created = r.created_at ?? this.iso();
      insert.run(r.id, agentId, r.content, created, r.updated_at ?? created);
      added++;
    }
    return { added, skipped };
  }

  private iso(): string { return new Date(this.now()).toISOString(); }
}

/** Parses {"facts": [...]} from a model reply, tolerating code fences and prose. Never throws. */
export function parseFacts(text: string | null | undefined): string[] {
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const facts = (JSON.parse(match[0]) as { facts?: unknown }).facts;
    return Array.isArray(facts) ? [...new Set(facts.filter((f): f is string => typeof f === 'string').map((f) => f.trim()).filter((f) => f && f.length <= 300))] : [];
  } catch { return []; }
}

export interface LocalMemoryOptions {
  /** Which animal a model-call assistant id belongs to (undefined for non-animal calls). */
  agentFor: (assistantId: string) => AgentId | undefined;
  /** False: recall only, never learn. */
  learn?: boolean;
  onError?: (agentId: AgentId, error: unknown) => void;
}

export function withLocalMemory(inner: LlmClient, store: LocalMemoryStore, opts: LocalMemoryOptions) {
  const chains = new Map<AgentId, Promise<void>>();

  async function learn(agent: AgentId, p: SendParams): Promise<void> {
    const rules = RULES[agent];
    if (!rules?.FACT_EXTRACTION_PROMPT || !rules.FACT_EXAMPLE) return;
    const res = await inner.send({ assistantId: p.assistantId, content: p.content, model: p.model, tools: [], memory: 'off', webSearch: 'off',
      jsonOutput: true, timeoutMs: 20_000, systemPrompt: withFactFormat(rules.FACT_EXTRACTION_PROMPT, rules.FACT_EXAMPLE) });
    const known = new Set((await store.list(agent)).map((m) => m.content.trim().toLowerCase()));
    for (const fact of parseFacts(res.content)) {
      if (known.has(fact.toLowerCase())) continue;
      known.add(fact.toLowerCase());
      await store.add(agent, fact);
    }
  }

  const client: LlmClient & { whenIdle(): Promise<void> } = {
    async send(p: SendParams): Promise<LlmResponse> {
      const agent = opts.agentFor(p.assistantId);
      const mode = p.memory ?? 'off';
      if (!agent || agent === 'wolf' || mode === 'off') return inner.send(p);
      let recalled: Memory[] = [];
      try { recalled = await store.search(agent, p.content, RECALL_LIMIT); } catch (e) { opts.onError?.(agent, e); }
      const content = recalled.length ? `[memories]\n${recalled.map((m) => `- ${m.content}`).join('\n')}\n[/memories]\n\n${p.content}` : p.content;
      const res = await inner.send({ ...p, content, memory: 'off' });
      if (mode === 'Auto' && opts.learn !== false) {
        const next = (chains.get(agent) ?? Promise.resolve()).then(() => learn(agent, p)).catch((e) => opts.onError?.(agent, e));
        chains.set(agent, next);
      }
      return recalled.length ? { ...res, retrieved_memories: recalled.map((m) => m.content) } : res;
    },
    submitToolOutputs(threadId: string, outputs: { tool_call_id: string; output: string }[], signal?: AbortSignal, model?: ModelChoice) {
      return inner.submitToolOutputs(threadId, outputs, signal, model);
    },
    async whenIdle() { await Promise.all([...chains.values()]); },
  };
  return client;
}
