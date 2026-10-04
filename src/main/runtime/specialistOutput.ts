import type { AgentResult } from './types';
import { sanitizeLlmText } from './sanitizeLlmText';

type Speech = Pick<AgentResult, 'say' | 'bubble' | 'summary'>;

/** The three labelled fields are required; malformed output falls back to a short first sentence. */
export function parseSpecialistOutput(content: string | null | undefined, agentName: string): Speech {
  const text = sanitizeLlmText(content);
  const fields: Partial<Record<'BUBBLE' | 'SAY' | 'SUMMARY', string>> = {};
  let current: keyof typeof fields | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = /^(BUBBLE|SAY|SUMMARY):\s*(.*)$/i.exec(line.trim());
    if (match) {
      current = match[1]!.toUpperCase() as keyof typeof fields;
      fields[current] = match[2]!.trim();
    } else if (current) {
      fields[current] = `${fields[current]}\n${line}`.trim();
    }
  }
  if (fields.BUBBLE && fields.SAY && fields.SUMMARY) {
    return { bubble: fields.BUBBLE, say: fields.SAY, summary: fields.SUMMARY };
  }
  const first = (text.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? text.split(/\r?\n/)[0] ?? '').trim();
  return { bubble: agentName, say: first.split(/\s+/).filter(Boolean).slice(0, 12).join(' '), summary: text };
}
