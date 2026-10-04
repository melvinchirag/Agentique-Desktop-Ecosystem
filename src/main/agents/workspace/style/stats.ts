import type { CleanedEmail, StyleProfile } from './types';
import { wordCount } from './cleaner';

export interface StyleStats {
  greetings: [string, number][];
  signoffs: [string, number][];
  avgWords: number;
  avgSentences: number;
  avgParagraphs: number;
  emojiRate: number;
  exclamationRate: number;
  contractionRate: number;
  lowercaseStartRate: number;
  replyRate: number;
}

function frequencies(values: (string | undefined)[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function computeStats(emails: CleanedEmail[]): StyleStats {
  const count = emails.length || 1;
  const sum = (fn: (email: CleanedEmail) => number) => emails.reduce((total, email) => total + fn(email), 0) / count;
  return {
    greetings: frequencies(emails.map(email => email.greeting)),
    signoffs: frequencies(emails.map(email => email.signoff)),
    avgWords: Math.round(sum(email => wordCount(email.text))),
    avgSentences: Math.round(sum(email => Math.max(1, (email.text.match(/[.!?]+(?:\s|$)/g) ?? []).length)) * 10) / 10,
    avgParagraphs: Math.round(sum(email => email.text.split(/\n\s*\n/).length) * 10) / 10,
    emojiRate: sum(email => /\p{Extended_Pictographic}/u.test(email.text) ? 1 : 0),
    exclamationRate: sum(email => email.text.includes('!') ? 1 : 0),
    contractionRate: sum(email => /\b\w+(?:n't|'(?:m|re|ve|ll|d|s))\b/i.test(email.text) ? 1 : 0),
    lowercaseStartRate: sum(email => /^[a-z]/.test(email.text) ? 1 : 0),
    replyRate: sum(email => email.isReply ? 1 : 0),
  };
}

export function statsProfile(stats: StyleStats, sampled: number, learnedAt: string): StyleProfile {
  return {
    version: 1, learnedAt, sampled, source: 'stats',
    greetings: stats.greetings.slice(0, 5).map(([value]) => value),
    signoffs: stats.signoffs.slice(0, 4).map(([value]) => value),
    formality: stats.contractionRate > 0.4 || stats.exclamationRate > 0.5 ? 2 : 3,
    avgWords: stats.avgWords, avgSentences: stats.avgSentences,
    paragraphs: stats.avgParagraphs < 1.5 ? 'one' : stats.avgParagraphs < 3 ? 'short' : 'multi',
    emojiUse: stats.emojiRate < 0.05 ? 'never' : stats.emojiRate < 0.4 ? 'rare' : 'often',
    exclamations: stats.exclamationRate < 0.15 ? 'rare' : stats.exclamationRate < 0.5 ? 'some' : 'often',
    contractions: stats.contractionRate >= 0.3, startsLowercase: stats.lowercaseStartRate >= 0.3,
    quirks: [], examples: [],
  };
}
