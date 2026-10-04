import type { DocsRequest } from './api';

type InlineStyle = { start: number; end: number; bold?: true; link?: string };
type Paragraph = { start: number; end: number; kind: 'plain' | 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'number'; styles: InlineStyle[] };

function httpsLink(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname && !/[\r\n]/.test(candidate) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Parse only the inline Markdown supported by Pixel. Offsets are JS string lengths (UTF-16). */
function inline(source: string): { text: string; styles: InlineStyle[] } {
  let text = '';
  const styles: InlineStyle[] = [];
  function append(segment: string, bold = false, link?: string): void {
    if (!segment) return;
    const start = text.length;
    text += segment;
    const end = text.length;
    if (bold) styles.push({ start, end, bold: true });
    if (link) styles.push({ start, end, link });
  }
  function parse(fragment: string, bold = false, link?: string): void {
    for (let i = 0; i < fragment.length;) {
      if (fragment.startsWith('**', i)) {
        const end = fragment.indexOf('**', i + 2);
        if (end > i + 2) {
          parse(fragment.slice(i + 2, end), !bold, link);
          i = end + 2;
          continue;
        }
      }
      if (fragment[i] === '[') {
        const close = fragment.indexOf('](', i + 1);
        const end = close < 0 ? -1 : fragment.indexOf(')', close + 2);
        if (end > close) {
          const label = fragment.slice(i + 1, close);
          const href = httpsLink(fragment.slice(close + 2, end));
          parse(label, bold, href ?? link);
          i = end + 1;
          continue;
        }
      }
      const start = i++;
      while (i < fragment.length && !fragment.startsWith('**', i) && fragment[i] !== '[') i++;
      append(fragment.slice(start, i), bold, link);
    }
  }
  parse(source);
  return { text, styles };
}

function classify(line: string): { kind: Paragraph['kind']; content: string } {
  const heading = /^(#{1,3})\s+(.+)$/.exec(line);
  if (heading) return { kind: `heading${heading[1]!.length}` as Paragraph['kind'], content: heading[2]! };
  const bullet = /^-\s+(.+)$/.exec(line);
  if (bullet) return { kind: 'bullet', content: bullet[1]! };
  const number = /^\d+\.\s+(.+)$/.exec(line);
  if (number) return { kind: 'number', content: number[1]! };
  return { kind: 'plain', content: line };
}

/** One insert followed by styling requests. startIndex=1 creates; endIndex-1 appends. */
export function markdownToDocsRequests(markdown: string, startIndex = 1): DocsRequest[] {
  if (!Number.isInteger(startIndex) || startIndex < 1) throw new Error('BAD_DOC_INDEX');
  if (!markdown) return [];
  const paragraphs: Paragraph[] = [];
  let text = '';
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const { kind, content } = classify(line);
    const rendered = inline(content);
    const start = startIndex + text.length;
    text += `${rendered.text}\n`;
    paragraphs.push({
      start, end: startIndex + text.length, kind,
      styles: rendered.styles.map((style) => ({ ...style, start: start + style.start, end: start + style.end })),
    });
  }
  const requests: DocsRequest[] = [{ insertText: { location: { index: startIndex }, text } }];
  for (const paragraph of paragraphs) {
    if (!paragraph.kind.startsWith('heading')) continue;
    requests.push({ updateParagraphStyle: {
      range: { startIndex: paragraph.start, endIndex: paragraph.end },
      paragraphStyle: { namedStyleType: `HEADING_${paragraph.kind.at(-1)}` }, fields: 'namedStyleType',
    } });
  }
  for (let i = 0; i < paragraphs.length;) {
    const first = paragraphs[i]!;
    if (first.kind !== 'bullet' && first.kind !== 'number') { i++; continue; }
    let end = first.end;
    let next = i + 1;
    while (next < paragraphs.length && paragraphs[next]!.kind === first.kind) {
      end = paragraphs[next]!.end;
      next++;
    }
    requests.push({ createParagraphBullets: {
      range: { startIndex: first.start, endIndex: end },
      bulletPreset: first.kind === 'bullet' ? 'BULLET_DISC_CIRCLE_SQUARE' : 'NUMBERED_DECIMAL_ALPHA_ROMAN',
    } });
    i = next;
  }
  for (const paragraph of paragraphs) {
    for (const style of paragraph.styles) {
      requests.push({ updateTextStyle: {
        range: { startIndex: style.start, endIndex: style.end },
        textStyle: style.bold ? { bold: true } : { link: { url: style.link } },
        fields: style.bold ? 'bold' : 'link',
      } });
    }
  }
  return requests;
}
