export interface ChipOutput { silent: boolean; bubble: string; speech: string }

const SILENT: ChipOutput = { silent: true, bubble: '', speech: '' };
const MAX_SENTENCES = 3;

/** Chip spec §11 output parsing, rules 1–4. */
export function parseChipOutput(text: string | null | undefined): ChipOutput {
  const trimmed = (text ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === '(silent)') return { ...SILENT };

  const lines = trimmed.split(/\r?\n/);
  const bubbleMatch = /^\[bubble:\s*(.+?)\]$/.exec(lines[0].trim());
  const body = bubbleMatch ? lines.slice(1) : lines;

  const speech = firstSentences(stripMarkdown(body.join('\n')), MAX_SENTENCES);
  if (!speech) return { ...SILENT };

  const bubble = bubbleMatch ? bubbleMatch[1].trim() : speech.split(/\s+/).slice(0, 2).join(' ');
  return { silent: false, bubble, speech };
}

function stripMarkdown(s: string): string {
  return s
    .split('\n')
    .map((line) => line.trim().replace(/^#+\s*/, '').replace(/^-\s+/, '').replace(/\*/g, ''))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits after `.`, `!`, `?` that end a sentence (followed by whitespace or the end), so "4.6★" stays whole. */
function firstSentences(s: string, max: number): string {
  const sentences = s.match(/.+?[.!?]+(?=\s|$)|.+$/g) ?? [];
  return sentences.slice(0, max).map((x) => x.trim()).join(' ').trim();
}
