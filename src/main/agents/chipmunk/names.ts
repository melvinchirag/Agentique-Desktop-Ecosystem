import type { AgentId } from '../../../shared/agents';
import { AGENTS } from '../../../shared/config';
import type { SpecialistId } from '../../runtime/types';

export const SPECIALIST_IDS: SpecialistId[] = ['workspace', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale'];

/** Display name used in speech and UI: "Scout". */
export function nameOf(id: AgentId): string {
  return AGENTS[id].displayName;
}

/** What Chip reads: "Scout [eagle]". */
export function labelOf(id: AgentId): string {
  return `${nameOf(id)} [${id}]`;
}

/** "scout", "Scout", "eagle" → 'eagle'. Case-insensitive; accepts names or ids. Never returns chipmunk/wolf. */
export function specialistFromWord(word: string): SpecialistId | undefined {
  const w = word.trim().toLowerCase();
  if (!w) return undefined;
  return SPECIALIST_IDS.find((id) => id === w || nameOf(id).toLowerCase() === w);
}
