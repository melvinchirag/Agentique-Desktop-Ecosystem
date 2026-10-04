import type { UserMood } from '../../../shared/agents';
import type { SpecialistId, SubmitStatus } from '../../runtime/types';
import { nameOf } from './names';

const EMOJI: Record<SpecialistId, string> = {
  workspace: '📬',
  beaver: '🪵',
  eagle: '🦅',
  ants: '🐜',
  butterfly: '🦋',
  nightingale: '🎵',
};

/** Spec §13 "started" lines, one per animal. */
const STARTED_LINES: Record<SpecialistId, (name: string) => string[]> = {
  workspace: (n) => [`Ooh, mail duty! ${n}, you're up!`],
  beaver: (n) => [`${n}! Files! Go go go!`],
  eagle: (n) => [`${n}, fly! We need intel!`],
  ants: (n) => [`${n}, assemble!`],
  butterfly: (n) => [`${n}, work your magic!`],
  nightingale: (n) => [`${n}, hit it!`],
};

/** Instant spoken line + bubble after Chip's first delegate of a user turn (spec §13). No AI call. */
export function pickAck(
  agent: SpecialistId,
  status: SubmitStatus,
  userMood: UserMood,
  rand: () => number = Math.random,
): { text: string; bubble: string } | null {
  if (status === 'not_installed') return null;
  if (userMood === 'angry' || userMood === 'stressed') return { text: 'On it.', bubble: 'On it' };

  const name = nameOf(agent);
  switch (status) {
    case 'started':
    case 'woke_and_started':
      return { text: pick(STARTED_LINES[agent](name), rand), bubble: `${name} ${EMOJI[agent]}` };
    case 'queued':
      return { text: `${name}'s busy. You're next in line!`, bubble: 'Next ⏳' };
    case 'duplicate':
      return { text: `${name}'s already on it!`, bubble: 'On it 👍' };
  }
}

function pick(lines: string[], rand: () => number): string {
  if (lines.length === 1) return lines[0];
  const i = Math.min(lines.length - 1, Math.max(0, Math.floor(rand() * lines.length)));
  return lines[i];
}
