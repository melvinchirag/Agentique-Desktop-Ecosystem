import type { AgentId } from '../../shared/agents';

export type ClipTier = 'required' | 'recommended' | 'signature';

export interface ClipCheckResult {
  name: string;
  tier: ClipTier;
  found: boolean;
  via?: string;
}

/**
 * Core required clips (1–6 from ASSETS.md §3.1) required for every animal.
 */
export const CORE_REQUIRED_CLIPS = [
  'Idle',
  'Walk',
  'Talk',
  'Work',
  'Happy',
  'Scared'
] as const;

/**
 * Standard recommended clips (7–12 from ASSETS.md §3.1).
 */
export const STANDARD_RECOMMENDED_CLIPS = [
  'Think',
  'Sad',
  'Sleep',
  'Greet',
  'Yawn',
  'SleepWalk'
] as const;

/**
 * Recommended clips for Chip (Chip never docks into the Hub, so SleepWalk is not needed).
 */
export const CHIP_RECOMMENDED_CLIPS = [
  'Think',
  'Sad',
  'Sleep',
  'Greet',
  'Yawn'
] as const;

/**
 * Per-animal signature clips from ASSETS.md §3.2, chip-actions.md, and archie-actions.md.
 */
export const SIGNATURE_CLIPS: Record<AgentId, string[]> = {
  // chip-actions.md (excluding core required & chip recommended)
  chipmunk: [
    'Run',
    'Handoff',
    'Listen',
    'Nervous',
    'Excited',
    'Relief',
    'Celebrate',
    'WakeUp',
    'Nudge',
    'Dizzy'
  ],
  // archie-actions.md (excluding core required & standard recommended)
  beaver: [
    'Carry',
    'TailSlap',
    'Read',
    'HoldNote',
    'Nervous',
    'Excited',
    'Handoff',
    'Sniff',
    'WakeUp'
  ],
  // ASSETS.md §3.2
  wolf: ['Guard', 'Growl', 'Block', 'Howl', 'Sit'],
  // ASSETS.md §3.2
  workspace: ['Write', 'Handoff'],
  // ASSETS.md §3.2
  eagle: ['Fly', 'Glide', 'Land', 'Takeoff', 'Perch'],
  // ASSETS.md §3.2
  ants: ['Carry'],
  // ASSETS.md §3.2
  butterfly: ['Fly'],
  // ASSETS.md §3.2
  nightingale: ['Sing', 'Fly', 'Perch']
};

/**
 * Bird agents that accept 'Fly' in place of 'Walk'.
 */
export const BIRD_AGENTS = new Set<AgentId>(['eagle', 'butterfly', 'nightingale']);

export function isBirdAgent(agentId: string): boolean {
  return BIRD_AGENTS.has(agentId as AgentId);
}

/**
 * Infers an agent ID from a file or folder name.
 * Defaults to 'chipmunk'.
 */
export function guessAgentFromPath(filePathOrName: string): AgentId {
  const lower = filePathOrName.toLowerCase();
  if (lower.includes('chipmunk') || lower.includes('chip')) return 'chipmunk';
  if (lower.includes('beaver') || lower.includes('archie') || lower.includes('arch')) return 'beaver';
  if (lower.includes('wolf') || lower.includes('warden')) return 'wolf';
  if (lower.includes('workspace') || lower.includes('pixel')) return 'workspace';
  if (lower.includes('eagle') || lower.includes('scout')) return 'eagle';
  if (lower.includes('ant') || lower.includes('swarm')) return 'ants';
  if (lower.includes('butterfly') || lower.includes('iris')) return 'butterfly';
  if (lower.includes('nightingale') || lower.includes('celene')) return 'nightingale';
  return 'chipmunk';
}

/**
 * Checks clips found in a model against the required, recommended, and signature sets.
 *
 * Rules:
 * - Birds (eagle, butterfly, nightingale) accept 'Fly' for 'Walk'.
 * - Chip ('chipmunk') does not need 'SleepWalk'.
 * - Honors clipMap aliases from character.json (e.g. { "Work": "Scribble" }).
 */
export function checkClips(
  agentId: AgentId | string,
  foundClips: string[],
  clipMap?: Record<string, string>
): ClipCheckResult[] {
  const foundSet = new Set(foundClips);
  const normalizedAgent = (agentId in SIGNATURE_CLIPS ? agentId : 'chipmunk') as AgentId;
  const isBird = isBirdAgent(normalizedAgent);

  const recommendedList =
    normalizedAgent === 'chipmunk' ? CHIP_RECOMMENDED_CLIPS : STANDARD_RECOMMENDED_CLIPS;
  const signatureList = SIGNATURE_CLIPS[normalizedAgent] ?? [];

  function evaluateClip(name: string, tier: ClipTier): ClipCheckResult {
    // 1. Direct match
    if (foundSet.has(name)) {
      return { name, tier, found: true };
    }

    // 2. clipMap alias (target -> source, e.g. clipMap["Work"] = "Scribble")
    if (clipMap && clipMap[name] && foundSet.has(clipMap[name])) {
      return { name, tier, found: true, via: clipMap[name] };
    }

    // Also support reverse clipMap (source -> target, e.g. clipMap["Scribble"] = "Work")
    if (clipMap) {
      for (const [key, value] of Object.entries(clipMap)) {
        if (value === name && foundSet.has(key)) {
          return { name, tier, found: true, via: key };
        }
      }
    }

    // 3. Bird 'Fly' for 'Walk' rule
    if (name === 'Walk' && isBird) {
      if (foundSet.has('Fly')) {
        return { name, tier, found: true, via: 'Fly' };
      }
      if (clipMap && clipMap['Fly'] && foundSet.has(clipMap['Fly'])) {
        return { name, tier, found: true, via: clipMap['Fly'] };
      }
    }

    return { name, tier, found: false };
  }

  const results: ClipCheckResult[] = [];

  for (const name of CORE_REQUIRED_CLIPS) {
    results.push(evaluateClip(name, 'required'));
  }

  for (const name of recommendedList) {
    results.push(evaluateClip(name, 'recommended'));
  }

  for (const name of signatureList) {
    results.push(evaluateClip(name, 'signature'));
  }

  return results;
}
