import type { AgentId } from '../../shared/agents';
import type { BackboardClient } from '../runtime/backboard';
import type { Memory, MemoryApi } from '../runtime/types';

const toMemory = (raw: Record<string, any>): Memory => ({
  id: String(raw.id),
  content: String(raw.content ?? raw.memory ?? ''),
  ...(raw.created_at ? { created_at: raw.created_at } : {}),
  ...(raw.updated_at ? { updated_at: raw.updated_at } : {}),
});

/**
 * What each animal remembers, for the Memory screen (list / search / edit / erase).
 * Paths confirmed in docs/sponsor-verify.md §B2. Search is a POST.
 */
export class BackboardMemoryApi implements MemoryApi {
  constructor(private readonly client: BackboardClient, private readonly assistantIds: Partial<Record<AgentId, string>>) {}

  private base(agentId: AgentId): string {
    const id = this.assistantIds[agentId];
    if (!id) throw new Error(`No Backboard assistant for "${agentId}". Run scripts/create-assistants.ts (BB_ASSISTANT_${agentId.toUpperCase()}).`);
    return `/assistants/${encodeURIComponent(id)}/memories`;
  }

  async list(agentId: AgentId): Promise<Memory[]> {
    const raw = await this.client.request(this.base(agentId), { retry: true });
    return ((raw.memories as Record<string, any>[]) ?? []).map(toMemory);
  }

  async search(agentId: AgentId, q: string): Promise<Memory[]> {
    const raw = await this.client.request(`${this.base(agentId)}/search`, { method: 'POST', body: { query: q, limit: 20 }, retry: true });
    return ((raw.memories as Record<string, any>[]) ?? []).map(toMemory);
  }

  async update(agentId: AgentId, id: string, text: string): Promise<void> {
    await this.client.request(`${this.base(agentId)}/${encodeURIComponent(id)}`, { method: 'PUT', body: { content: text } });
  }

  async remove(agentId: AgentId, id: string): Promise<void> {
    await this.client.request(`${this.base(agentId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Adds a memory directly (Pixel's email style line). This is the `MemoryWriter` contract (04-pixel-workspace.md §15); the class satisfies it structurally. */
  async add(agentId: AgentId, text: string): Promise<{ id: string }> {
    const raw = await this.client.request(this.base(agentId), { method: 'POST', body: { content: text } });
    return { id: String(raw.memory_id ?? raw.id) };
  }
}
