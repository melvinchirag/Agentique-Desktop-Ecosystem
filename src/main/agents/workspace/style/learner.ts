import type { GmailApi, GmailMessage } from '../../../connectors/google/api';
import type { LlmClient } from '../../../runtime/types';
import { cleanEmails } from './cleaner';
import { redact } from './redact';
import { computeStats, statsProfile } from './stats';
import { sampleEmails } from './sampler';
import type { StyleProfile } from './types';
import type { StyleStore } from './styleStore';

const LEARN_PROMPT = `You study how ONE person writes email. Return ONLY JSON with greetings, signoffs, formality, avgWords, avgSentences, paragraphs, emojiUse, exclamations, contractions, startsLowercase, quirks, examples, and optional notes. Describe patterns, not content. Use <name> for names. Examples must be rewritten to remove facts, names, dates, and numbers; never quote more than 8 consecutive words of a sample.`;

export interface LearnProgress { phase: 'fetching' | 'cleaning' | 'learning' | 'saving' | 'done'; completed: number; total: number }
export interface LearnDeps {
  gmail: GmailApi;
  llm: LlmClient;
  assistantId: string;
  store: StyleStore;
  onProgress?: (progress: LearnProgress) => void;
  now?: () => Date;
}

function stringList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || item.length > 160)) return null;
  return value;
}

function parseProfile(text: string | null | undefined, base: StyleProfile): StyleProfile {
  if (!text) throw new Error('Empty style JSON');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid style JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Style JSON must be an object');
  const p = value as Record<string, unknown>;
  const greetings = stringList(p.greetings, 5);
  const signoffs = stringList(p.signoffs, 4);
  const quirks = stringList(p.quirks, 6);
  const examples = stringList(p.examples, 3);
  if (!greetings || !signoffs || !quirks || !examples || ![1, 2, 3, 4, 5].includes(p.formality as number)
    || typeof p.avgWords !== 'number' || !Number.isFinite(p.avgWords) || p.avgWords < 0
    || typeof p.avgSentences !== 'number' || !Number.isFinite(p.avgSentences) || p.avgSentences < 0
    || !['one', 'short', 'multi'].includes(p.paragraphs as string)
    || !['never', 'rare', 'often'].includes(p.emojiUse as string)
    || !['rare', 'some', 'often'].includes(p.exclamations as string)
    || typeof p.contractions !== 'boolean' || typeof p.startsLowercase !== 'boolean'
    || (p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 300))) throw new Error('Invalid style fields');
  // Generated examples can invent facts; keep only de-identified, short patterns.
  const safeExamples = examples.filter(example => example.split(/\s+/).length <= 30)
    .map(example => redact(example).replace(/\b(?:19|20)\d{2}\b/g, '<number>'))
    .filter(example => !/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(example));
  return {
    ...base, source: 'llm',
    // Only observed, already redacted patterns may enter the memory mirror.
    greetings: base.greetings.length ? base.greetings : greetings.filter(item => /^\s*(?:hi|hey|hello|dear|good (?:morning|afternoon|evening))\b/i.test(item)).map(item => redact(item)),
    signoffs: base.signoffs.length ? base.signoffs : signoffs.filter(item => /^(?:thanks|best|sincerely|cheers|regards)\b/i.test(item)).map(item => redact(item)),
    formality: p.formality as StyleProfile['formality'],
    avgWords: p.avgWords, avgSentences: p.avgSentences, paragraphs: p.paragraphs as StyleProfile['paragraphs'],
    emojiUse: p.emojiUse as StyleProfile['emojiUse'], exclamations: p.exclamations as StyleProfile['exclamations'],
    contractions: p.contractions, startsLowercase: p.startsLowercase,
    quirks: quirks.map(item => redact(item)), examples: safeExamples,
    notes: p.notes ? redact(p.notes as string) : undefined,
  };
}

export async function learnEmailStyle(deps: LearnDeps): Promise<{ sampled: number; profile: StyleProfile }> {
  const summaries = (await deps.gmail.listSent(100)).slice(0, 100);
  const messages: GmailMessage[] = [];
  for (let index = 0; index < summaries.length; index += 5) {
    messages.push(...await Promise.all(summaries.slice(index, index + 5).map(item => deps.gmail.getMessage(item.id))));
    deps.onProgress?.({ phase: 'fetching', completed: messages.length, total: summaries.length });
  }
  deps.onProgress?.({ phase: 'cleaning', completed: 0, total: messages.length });
  const cleaned = cleanEmails(messages);
  const redacted = cleaned.map(email => ({ ...email, text: redact(email.text, email.recipientName),
    greeting: email.greeting && redact(email.greeting, email.recipientName),
    signoff: email.signoff && redact(email.signoff, email.recipientName), recipientName: undefined }));
  const stats = computeStats(redacted);
  const samples = sampleEmails(redacted);
  const base = statsProfile(stats, cleaned.length, (deps.now?.() ?? new Date()).toISOString());
  deps.onProgress?.({ phase: 'learning', completed: 0, total: 1 });
  let profile = base;
  const content = `${LEARN_PROMPT}\nSTATS: ${JSON.stringify(stats)}\nSAMPLES: ${JSON.stringify(samples)}`;
  let validationError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await deps.llm.send({ assistantId: deps.assistantId, content: attempt ? `${content}\nThe previous JSON failed validation: ${validationError}. Return valid JSON with all required fields.` : content,
        memory: 'off', webSearch: 'off', jsonOutput: true, tools: [] });
      if (response.tool_calls?.length || response.status === 'REQUIRES_ACTION') throw new Error('Unexpected tool call');
      profile = parseProfile(response.content, base);
      break;
    } catch (error) { validationError = error instanceof Error ? error.message : 'Invalid response'; }
  }
  deps.onProgress?.({ phase: 'saving', completed: 0, total: 1 });
  await deps.store.save(profile);
  deps.onProgress?.({ phase: 'done', completed: cleaned.length, total: cleaned.length });
  return { sampled: cleaned.length, profile };
}
