/** Each animal's memory rules, in one map, so the local extractor reuses the exact text Backboard used. */
import type { AgentId } from '../../shared/agents';
import * as ants from '../agents/ants/memory-rules';
import * as beaver from '../agents/beaver/memory-rules';
import * as butterfly from '../agents/butterfly/memory-rules';
import * as chipmunk from '../agents/chipmunk/memory-rules';
import * as eagle from '../agents/eagle/memory-rules';
import * as nightingale from '../agents/nightingale/memory-rules';
import * as wolf from '../agents/wolf/memory-rules';
import * as workspace from '../agents/workspace/memory-rules';
import type { FactExample } from '../sponsors/memoryFormat';

export interface MemoryRules { extraction: string; update: string; example: FactExample }

const pick = (m: { FACT_EXTRACTION_PROMPT?: string; UPDATE_MEMORY_PROMPT?: string; FACT_EXAMPLE?: FactExample }): MemoryRules | undefined =>
  m.FACT_EXTRACTION_PROMPT && m.UPDATE_MEMORY_PROMPT && m.FACT_EXAMPLE
    ? { extraction: m.FACT_EXTRACTION_PROMPT, update: m.UPDATE_MEMORY_PROMPT, example: m.FACT_EXAMPLE }
    : undefined;

/** Warden has no rules on purpose: a security guard remembers nothing. */
export const MEMORY_RULES: Record<AgentId, MemoryRules | undefined> = {
  chipmunk: pick(chipmunk), workspace: pick(workspace), wolf: pick(wolf), beaver: pick(beaver),
  eagle: pick(eagle), ants: pick(ants), butterfly: pick(butterfly), nightingale: pick(nightingale),
};
