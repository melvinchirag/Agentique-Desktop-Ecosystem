/**
 * Local PDF text extraction (Mozilla pdf.js, no network, no worker process). Replaces Backboard document
 * indexing for PDFs, so Archie can read a PDF with any brain and nothing leaves the machine.
 */
import { readFile } from 'node:fs/promises';

export interface PdfText { text: string; pages: number; pagesRead: number; truncated: boolean }
export type PdfError = { error: 'PDF_UNREADABLE' | 'PDF_NO_TEXT' | 'PDF_ENCRYPTED'; hint: string };

const MAX_PAGES = 200;

export async function extractPdfText(absPath: string, maxChars: number): Promise<PdfText | PdfError> {
  const data = new Uint8Array(await readFile(absPath));
  let doc: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentProxy;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  } catch (error) {
    const name = (error as { name?: string })?.name ?? '';
    if (name === 'PasswordException') return { error: 'PDF_ENCRYPTED', hint: 'The PDF needs a password; ADE cannot open it.' };
    return { error: 'PDF_UNREADABLE', hint: 'The file is not a readable PDF.' };
  }
  try {
    const parts: string[] = [];
    let length = 0, pagesRead = 0, truncated = false;
    const total = doc.numPages;
    for (let i = 1; i <= Math.min(total, MAX_PAGES); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = (content.items as { str?: string; hasEOL?: boolean }[]).map((item) => (typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      pagesRead = i;
      if (line) { parts.push(`[page ${i}]\n${line}`); length += line.length + 12; }
      if (length >= maxChars) { truncated = i < total; break; }
    }
    if (total > MAX_PAGES && pagesRead >= MAX_PAGES) truncated = true;
    const text = parts.join('\n\n').slice(0, maxChars);
    if (!text.trim()) return { error: 'PDF_NO_TEXT', hint: 'The PDF has no text layer (scanned image). ADE does not do OCR yet.' };
    return { text, pages: total, pagesRead, truncated };
  } finally {
    await doc.destroy().catch(() => {});
  }
}
