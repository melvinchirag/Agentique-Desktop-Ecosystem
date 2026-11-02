/**
 * Conversation threads owned by ADE, not by a model vendor. The CLI brain (Hydra's lane) reads and writes
 * history here: one long-lived thread for Chip, one per specialist job. `tokens` is a cheap estimate
 * (characters / 4) so the context window can be cut without a tokenizer.
 */
import { randomUUID } from 'node:crypto';
import type { LlmToolCall } from '../runtime/types';
import type { LocalDb } from './localDb';

export type ThreadRole = 'system' | 'user' | 'assistant' | 'tool';
export interface ThreadMessage { role: ThreadRole; content: string; toolCalls?: LlmToolCall[]; toolCallId?: string; ts: number; tokens: number }

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export interface ThreadStore {
  create(prefix: string): string;
  append(threadId: string, messages: Omit<ThreadMessage, 'tokens'>[]): void;
  get(threadId: string): ThreadMessage[];
  /** First system message plus the newest messages within `budgetTokens`; never orphans a tool result; never empty for a non-empty thread. */
  window(threadId: string, budgetTokens: number): ThreadMessage[];
  prune(threadId: string): void;
}

export function windowMessages(all: ThreadMessage[], budgetTokens: number): ThreadMessage[] {
  if (all.length === 0) return [];
  const sysIndex = all.findIndex((m) => m.role === 'system');
  const system = sysIndex >= 0 ? all[sysIndex]! : null;
  let budget = budgetTokens - (system?.tokens ?? 0);
  const picked: ThreadMessage[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (i === sysIndex) continue;
    const m = all[i]!;
    if (picked.length > 0 && m.tokens > budget) break;
    picked.unshift(m);
    budget -= m.tokens;
  }
  while (picked.length > 1 && picked[0]!.role === 'tool') picked.shift();
  return system ? [system, ...picked] : picked;
}

export class SqliteThreadStore implements ThreadStore {
  constructor(private readonly db: LocalDb) {}

  create(prefix: string): string { return `${prefix}-${randomUUID()}`; }

  append(threadId: string, messages: Omit<ThreadMessage, 'tokens'>[]): void {
    const insert = this.db.prepare('INSERT INTO thread_messages (thread_id, role, content, tool_calls, tool_call_id, ts, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const m of messages) {
      insert.run(threadId, m.role, m.content, m.toolCalls ? JSON.stringify(m.toolCalls) : null, m.toolCallId ?? null, m.ts,
        estimateTokens(m.content) + (m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0));
    }
  }

  get(threadId: string): ThreadMessage[] {
    return (this.db.prepare('SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY rowid').all(threadId) as Record<string, any>[]).map((r) => ({
      role: r.role as ThreadRole, content: String(r.content), ts: Number(r.ts), tokens: Number(r.tokens),
      ...(r.tool_calls ? { toolCalls: JSON.parse(String(r.tool_calls)) as LlmToolCall[] } : {}),
      ...(r.tool_call_id ? { toolCallId: String(r.tool_call_id) } : {}),
    }));
  }

  window(threadId: string, budgetTokens: number): ThreadMessage[] { return windowMessages(this.get(threadId), budgetTokens); }

  prune(threadId: string): void { this.db.prepare('DELETE FROM thread_messages WHERE thread_id = ?').run(threadId); }
}
