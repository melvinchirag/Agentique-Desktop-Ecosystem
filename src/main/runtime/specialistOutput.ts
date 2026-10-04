import type { AgentResult } from './types';
import { sanitizeLlmText } from './sanitizeLlmText';

type Speech = Pick<AgentResult, 'say' | 'bubble' | 'summary'>;

/** Backboard web search may return prose instead of the requested labelled fields. */
export function parseSpecialistOutput(content: string | null | undefined, agentName: string): Speech {
  const text = sanitizeLlmText(content);
  const fields: Partial<Record<'BUBBLE' | 'SAY' | 'SUMMARY', string>> = {};
  const prose: string[] = [];
  let current: keyof typeof fields | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = /^(BUBBLE|SAY|SUMMARY):\s*(.*)$/i.exec(line.trim());
    if (match) {
      current = match[1]!.toUpperCase() as keyof typeof fields;
      fields[current] = match[2]!.trim();
    } else if (current) {
      fields[current] = `${fields[current]}\n${line}`.trim();
    } else {
      prose.push(line);
    }
  }
  const summary = fields.SUMMARY || [prose.join('\n').trim(), fields.SAY].filter(Boolean).join('\n')
    || fields.BUBBLE || '';
  const first = (summary.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? summary.split(/\r?\n/)[0] ?? '').trim();
  return {
    bubble: fields.BUBBLE && (fields.SAY || fields.SUMMARY) ? fields.BUBBLE : agentName,
    say: fields.SAY || first.split(/\s+/).filter(Boolean).slice(0, 12).join(' '),
    summary,
  };
}
