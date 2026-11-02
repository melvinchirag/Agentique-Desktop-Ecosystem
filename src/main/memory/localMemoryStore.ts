/**
 * LocalMemoryStore: every animal's memories in one JSON file on the user's machine.
 * Replaces Backboard memory (BackboardMemoryApi). Same MemoryApi + MemoryWriter the Hub and Pixel's
 * StyleStore already use, plus RecallProvider for the turn. Search and recall semantics are the
 * shared ones in runtime/recall.ts (whole words, stopwords dropped, 20 max).
 *
 * File: <dataDir>/memories.json, mode 0600, written atomically (tmp then rename) after every change.
 * Format v1: { "version": 1, "agents": { "<agentId>": [ { id, content, created_at, updated_at } ] } }.
 * A missing or unreadable file starts empty; an unreadable file is kept aside as memories.json.bad.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentId } from '../../shared/agents';
import type { RecallProvider } from '../runtime/recall';
import type { Memory, MemoryApi, MemoryWriter } from '../runtime/types';
import { InMemoryMemoryStore } from '../testing/inMemoryMemoryStore';

export const MEMORIES_FILE_VERSION = 1;

interface FileShape { version: number; agents: Partial<Record<AgentId, Memory[]>> }

export class LocalMemoryStore implements MemoryApi, MemoryWriter, RecallProvider {
  private readonly store: InMemoryMemoryStore;

  constructor(readonly filePath: string, private readonly now: () => number = () => Date.now()) {
    this.store = new InMemoryMemoryStore(now);
    this.load();
  }

  list(agentId: AgentId): Promise<Memory[]> { return this.store.list(agentId); }
  search(agentId: AgentId, q: string): Promise<Memory[]> { return this.store.search(agentId, q); }
  recall(agentId: AgentId, text: string, k?: number): Promise<Memory[]> { return this.store.recall(agentId, text, k); }

  async update(agentId: AgentId, id: string, text: string): Promise<void> { await this.store.update(agentId, id, text); this.save(); }
  async remove(agentId: AgentId, id: string): Promise<void> { await this.store.remove(agentId, id); this.save(); }
  async add(agentId: AgentId, text: string): Promise<{ id: string }> { const r = await this.store.add(agentId, text); this.save(); return r; }

  /** Bulk import that keeps the rows' own ids and timestamps (used for the Backboard export). Skips exact duplicates. */
  async importRows(agentId: AgentId, rows: Memory[]): Promise<{ added: number; skipped: number }> {
    const existing = new Set((await this.store.list(agentId)).map((m) => m.content.trim().toLowerCase()));
    const snap = this.store.snapshot();
    const target = snap[agentId] ?? [];
    let added = 0, skipped = 0;
    for (const r of rows) {
      const key = r.content.trim().toLowerCase();
      if (!key || existing.has(key)) { skipped++; continue; }
      existing.add(key);
      target.push({ id: r.id, content: r.content, created_at: r.created_at, updated_at: r.updated_at ?? r.created_at });
      added++;
    }
    snap[agentId] = target;
    this.store.restore(snap);
    this.save();
    return { added, skipped };
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as FileShape;
      if (!parsed || typeof parsed !== 'object' || !parsed.agents) throw new Error('not a memories file');
      this.store.restore(parsed.agents);
    } catch (e) {
      try { renameSync(this.filePath, `${this.filePath}.bad`); } catch { /* keep going empty */ }
      console.warn(`[memory] ${this.filePath} was unreadable (${(e as Error).message}); started empty, old file kept as .bad`);
    }
  }

  private save(): void {
    const body: FileShape = { version: MEMORIES_FILE_VERSION, agents: this.store.snapshot() };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
}
