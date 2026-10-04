import { describe, expect, it } from 'vitest';
import { markdownToDocsRequests } from '../../src/main/connectors/google/docsMarkdown';

describe('markdownToDocsRequests', () => {
  it('uses UTF-16 indices after an emoji+CJK heading and builds one bullet list', () => {
    const requests = markdownToDocsRequests('# 🚀中文\n- **Bold** [site](https://example.com/path)\n- second');
    const inserted = (requests[0]!.insertText as { text: string }).text;
    expect(inserted).toBe('🚀中文\nBold site\nsecond\n');
    const heading = requests.find((request) => request.updateParagraphStyle)!.updateParagraphStyle as any;
    expect(heading.range).toEqual({ startIndex: 1, endIndex: 6 });
    const bullets = requests.filter((request) => request.createParagraphBullets);
    expect(bullets).toHaveLength(1);
    expect((bullets[0]!.createParagraphBullets as any).range).toEqual({ startIndex: 6, endIndex: 23 });
    const styles = requests.filter((request) => request.updateTextStyle).map((request) => request.updateTextStyle as any);
    expect(styles).toContainEqual({ range: { startIndex: 6, endIndex: 10 }, textStyle: { bold: true }, fields: 'bold' });
    expect(styles).toContainEqual({ range: { startIndex: 11, endIndex: 15 }, textStyle: { link: { url: 'https://example.com/path' } }, fields: 'link' });
  });

  it('renders paragraphs and numbered lists; ignores insecure links', () => {
    const requests = markdownToDocsRequests('Paragraph [bad](http://example.com)\n\n1. First\n2. Second', 10);
    expect((requests[0]!.insertText as any).location.index).toBe(10);
    expect((requests[0]!.insertText as any).text).toBe('Paragraph bad\n\nFirst\nSecond\n');
    expect(requests.filter((request) => request.updateTextStyle)).toHaveLength(0);
    expect((requests.find((request) => request.createParagraphBullets)!.createParagraphBullets as any).bulletPreset).toBe('NUMBERED_DECIMAL_ALPHA_ROMAN');
  });

  it('does not add a second paragraph to Markdown that ends with a newline', () => {
    expect((markdownToDocsRequests('Text\n')[0]!.insertText as any).text).toBe('Text\n');
  });
});
