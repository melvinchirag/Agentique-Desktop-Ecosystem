/**
 * InMemoryMemoryStore: the fake for MemoryApi + MemoryWriter + RecallProvider (ADE v2, Phase C).
 * Keyword search and recall, per-agent isolation, ISO timestamps. The SQLite LocalMemoryStore (W3)
 * must behave the same; both run tests/contracts/memoryStore.contract.ts.
 */
import { randomUUID } from 'node:crypto';
import type { AgentId } from '../../shared/agents';
import { DEFAULT_RECALL_K, recallHits, recallTerms, type RecallProvider } from '../runtime/recall';
import type { Memory, MemoryApi, MemoryWriter } from '../runtime/types';

export const SEARCH_LIMIT = 20;

type Row = Memory & { created_at: string; updated_at: string };

export class InMemoryMemoryStore implements MemoryApi, MemoryWriter, RecallProvider {
  private readonly rows = new Map<AgentId, Row[]>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private of(agentId: AgentId): Row[] {
    let r = this.rows.get(agentId);
    if (!r) { r = []; this.rows.set(agentId, r); }
    return r;
  }

  async list(agentId: AgentId): Promise<Memory[]> {
    return [...this.of(agentId)].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((r) => ({ ...r }));
  }

  async search(agentId: AgentId, q: string): Promise<Memory[]> {
    return scoreRows(this.of(agentId), q).slice(0, SEARCH_LIMIT).map((r) => ({ ...r }));
  }

  async update(agentId: AgentId, id: string, text: string): Promise<void> {
    const row = this.of(agentId).find((r) => r.id === id);
    if (!row) throw new Error(`No memory "${id}" for ${agentId}`);
    row.content = text;
    row.updated_at = new Date(this.now()).toISOString();
  }

  async remove(agentId: AgentId, id: string): Promise<void> {
    const rows = this.of(agentId);
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows.splice(i, 1);
  }

  async add(agentId: AgentId, text: string): Promise<{ id: string }> {
    const ts = new Date(this.now()).toISOString();
    const row: Row = { id: randomUUID(), content: text, created_at: ts, updated_at: ts };
    this.of(agentId).push(row);
    return { id: row.id };
  }

  /** Everything, for persistence. Rows are copies. */
  snapshot(): Partial<Record<AgentId, Memory[]>> {
    const out: Partial<Record<AgentId, Memory[]>> = {};
    for (const [agent, rows] of this.rows) out[agent] = rows.map((r) => ({ ...r }));
    return out;
  }

  /** Replace everything from a snapshot. Rows without timestamps get `now`. */
  restore(data: Partial<Record<AgentId, Memory[]>>): void {
    this.rows.clear();
    const ts = new Date(this.now()).toISOString();
    for (const [agent, rows] of Object.entries(data) as [AgentId, Memory[] | undefined][]) {
      if (!rows) continue;
      this.rows.set(agent, rows.map((r) => ({ id: String(r.id), content: String(r.content), created_at: r.created_at ?? ts, updated_at: r.updated_at ?? r.created_at ?? ts })));
    }
  }

  async recall(agentId: AgentId, text: string, k = DEFAULT_RECALL_K): Promise<Memory[]> {
    const rows = this.of(agentId);
    const hits = scoreRows(rows, text);
    const picked: Row[] = hits.slice(0, k);
    if (picked.length < k) {
      const recent = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      for (const r of recent) {
        if (picked.length >= k) break;
        if (!picked.includes(r)) picked.push(r);
      }
    }
    return picked.map((r) => ({ ...r }));
  }
}

/** Rows that share at least one whole-word term with `q`, most hits first, then most recently updated. */
function scoreRows(rows: Row[], q: string): Row[] {
  const terms = recallTerms(q);
  if (terms.length === 0) return [];
  return rows
    .map((r) => ({ r, score: recallHits(r.content, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.updated_at.localeCompare(a.r.updated_at))
    .map((x) => x.r);
}
