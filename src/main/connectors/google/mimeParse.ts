export interface ParsedMime {
  headers: Record<string, string>;
  textBody: string;
  htmlBody?: string;
  hiddenText: string;
  attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId?: string }>;
}
export interface GmailPayload {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayload[];
}
export interface ParseOptions { maxBodyChars?: number; stripQuotes?: (text: string) => string }

const maxPartBytes = 25 * 1024 * 1024;

export function decodeBase64Url(value: string): Uint8Array {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decode(bytes: Uint8Array, charset: string): string {
  try { return new TextDecoder(charset, { fatal: false }).decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

function charsetOf(contentType: string): string {
  return /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ?? 'utf-8';
}

function headerMap(entries: Array<{ name: string; value: string }>): Record<string, string> {
  return Object.fromEntries(entries.map(({ name, value }) => [name.toLowerCase(), value]));
}

function quotedPrintable(value: string): Uint8Array {
  const soft = value.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && /^[0-9A-F]{2}$/i.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16)); i += 2;
    } else bytes.push(...Buffer.from(soft[i]));
  }
  return Uint8Array.from(bytes);
}

function decodeHeader(value: string): string {
  return value.replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_all, charset: string, type: string, data: string) => {
    const bytes = type.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : quotedPrintable(data.replace(/_/g, ' '));
    return decode(bytes, charset);
  });
}

function extractHtml(html: string): { visible: string; hidden: string } {
  const hidden: string[] = [];
  let visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  visible = visible.replace(/<([\w:-]+)\b([^>]*\b(?:hidden\b|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|color\s*:\s*white)[^"']*["'])[^>]*)>[\s\S]*?<\/\1>/gi, (match) => { hidden.push(match.replace(/<[^>]+>/g, ' ')); return ' '; });
  visible = visible.replace(/<\s*(?:br|\/p|\/div|\/li)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const entity = (s: string) => s.replace(/&(?:nbsp|amp|lt|gt|quot|#39|#x27);/gi, (v) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" })[v.toLowerCase()] ?? v).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { visible: entity(visible), hidden: entity(hidden.join(' ')) };
}

function collect(payload: GmailPayload, result: ParsedMime): void {
  const headers = headerMap(payload.headers ?? []);
  const mimeType = payload.mimeType ?? headers['content-type']?.split(';')[0] ?? 'text/plain';
  if (payload.parts?.length) { for (const part of payload.parts) collect(part, result); return; }
  const data = payload.body?.data ?? '';
  if (data.length > Math.ceil(maxPartBytes * 4 / 3) + 4 || (payload.body?.size ?? 0) > maxPartBytes) throw new Error('TOO_LARGE');
  const bytes = decodeBase64Url(data);
  if (payload.filename || payload.body?.attachmentId) {
    result.attachments.push({ filename: payload.filename ?? '', mimeType, size: payload.body?.size ?? bytes.length, attachmentId: payload.body?.attachmentId });
    return;
  }
  const value = decode(bytes, charsetOf(headers['content-type'] ?? ''));
  if (mimeType === 'text/plain') result.textBody ||= value;
  if (mimeType === 'text/html') {
    result.htmlBody ||= value;
    const extracted = extractHtml(value);
    result.hiddenText += extracted.hidden;
    if (!result.textBody) result.textBody = extracted.visible;
  }
}

export function parseGmailPayload(payload: GmailPayload, options: ParseOptions = {}): ParsedMime {
  const headers = headerMap(payload.headers ?? []);
  const result: ParsedMime = { headers, textBody: '', hiddenText: '', attachments: [] };
  collect(payload, result);
  result.textBody = (options.stripQuotes ?? stripQuotedText)(result.textBody).slice(0, options.maxBodyChars ?? 20_000);
  if (result.htmlBody) result.htmlBody = result.htmlBody.slice(0, options.maxBodyChars ?? 20_000);
  result.hiddenText = result.hiddenText.slice(0, options.maxBodyChars ?? 20_000);
  for (const [name, value] of Object.entries(headers)) headers[name] = decodeHeader(value);
  return result;
}

export function stripQuotedText(text: string): string {
  return text.split(/\r?\n(?:On .+ wrote:|From:\s.+|-----Original Message-----|>)/i, 1)[0].trim();
}

function parseHeaders(raw: string): { headers: Array<{ name: string; value: string }>; body: string } {
  const split = /\r?\n\r?\n/.exec(raw);
  if (!split || split.index === undefined) return { headers: [], body: raw };
  const entries = raw.slice(0, split.index).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  return {
    headers: entries.flatMap((line) => { const idx = line.indexOf(':'); return idx < 0 ? [] : [{ name: line.slice(0, idx), value: line.slice(idx + 1).trim() }]; }),
    body: raw.slice(split.index + split[0].length),
  };
}

function rawPart(raw: string): GmailPayload {
  if (raw.length > 35 * 1024 * 1024) throw new Error('TOO_LARGE');
  const { headers, body } = parseHeaders(raw);
  const map = headerMap(headers);
  const contentType = map['content-type'] ?? 'text/plain';
  const boundary = /boundary\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
  if (boundary && contentType.toLowerCase().startsWith('multipart/')) {
    const chunks = body.split(`--${boundary}`).slice(1).filter((chunk) => !chunk.startsWith('--'));
    return { headers, mimeType: contentType.split(';')[0], parts: chunks.map((chunk) => rawPart(chunk.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))) };
  }
  const transfer = map['content-transfer-encoding']?.toLowerCase();
  const bytes = transfer === 'base64' ? Buffer.from(body.replace(/\s/g, ''), 'base64')
    : transfer === 'quoted-printable' ? quotedPrintable(body) : Buffer.from(body, 'utf8');
  const disposition = map['content-disposition'] ?? '';
  const encodedName = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(disposition)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : /filename\s*=\s*"?([^";]+)/i.exec(disposition)?.[1];
  return { headers, mimeType: contentType.split(';')[0], filename, body: { data: Buffer.from(bytes).toString('base64'), size: bytes.length } };
}

export function parseMime(raw: string, options?: ParseOptions): ParsedMime {
  return parseGmailPayload(rawPart(raw), options);
}
