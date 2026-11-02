/**
 * RecallProvider: what an agent remembers that is relevant to this turn (ADE v2, Phase C contract).
 *
 * In v1 Backboard injected memories server-side and returned `retrieved_memories`. In v2 the context
 * compiler asks a RecallProvider before each turn and prepends the result; the orchestrator keeps
 * emitting `agent.recall` from what comes back, so the Hub's "Remembered:" line and the sparkle stay.
 *
 * CONTRACT (frozen in Phase C). Implementations: `noRecall` (here; the W4 brain builds against it)
 * and LocalMemoryStore.recall (W3). Memory modes keep their meaning: Auto = recall and extract,
 * Readonly = recall only, off = neither. Warden is never recalled for.
 */
import type { AgentId } from '../../shared/agents';
import type { Memory } from './types';

export interface RecallProvider {
  /** Up to `k` memories for `agentId` relevant to `text`: keyword hits first, then the most recent. */
  recall(agentId: AgentId, text: string, k?: number): Promise<Memory[]>;
}

export const DEFAULT_RECALL_K = 5;

/** The empty provider: no memories ever. */
export const noRecall: RecallProvider = {
  async recall(): Promise<Memory[]> {
    return [];
  },
};

/** Words that carry no memory signal. Short on purpose: a term list, not a language model. */
export const RECALL_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'about', 'what', 'when', 'where', 'which', 'who',
  'why', 'how', 'did', 'does', 'was', 'were', 'are', 'have', 'has', 'had', 'you', 'your', 'our', 'their', 'will', 'would',
  'can', 'could', 'should', 'just', 'like', 'get', 'got', 'please', 'tell', 'know', 'think', 'thing', 'things', 'something',
]);

/** Lowercased whole words of 3+ letters or digits, minus stopwords; shared by every keyword-based implementation. */
export function recallTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.filter((w) => !RECALL_STOPWORDS.has(w)))];
}

/** How many of `terms` appear as whole words in `content`. */
export function recallHits(content: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const words = new Set(content.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  return terms.filter((t) => words.has(t)).length;
}
