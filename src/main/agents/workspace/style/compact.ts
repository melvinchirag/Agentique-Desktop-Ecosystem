import type { StyleProfile } from './types';

const plain = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

/** Deliberately excludes examples, notes, and any sampled message text. */
export function compactStyle(profile: StyleProfile): string {
  const parts = [
    `greets ${profile.greetings.slice(0, 2).map(value => `"${plain(value)}"`).join(' or ') || 'variously'}`,
    `signs ${profile.signoffs.slice(0, 2).map(value => `"${plain(value)}"`).join(' or ') || 'variously'}`,
    `formality ${profile.formality}/5`,
    `~${profile.avgWords} words, ${profile.avgSentences} sentences, ${profile.paragraphs} paragraphs`,
    `${profile.emojiUse} emoji`, `${profile.exclamations} exclamations`,
    profile.contractions ? 'uses contractions' : 'few contractions',
    profile.startsLowercase ? 'sometimes starts lowercase' : 'capitalized starts',
  ];
  return `User email style: ${parts.join('; ')}`;
}
