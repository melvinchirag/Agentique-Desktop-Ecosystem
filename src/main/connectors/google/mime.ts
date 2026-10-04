import { randomBytes } from 'node:crypto';

export interface MimeAttachment { filename: string; contentType: string; data: Uint8Array }
export interface MimeInput {
  from?: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  attachments?: MimeAttachment[];
  inReplyTo?: string;
  references?: string[];
}

function safeHeader(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('BAD_ADDRESS');
  return value;
}

function address(value: string): string {
  safeHeader(value);
  if (!/^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]+$/.test(value)) throw new Error('BAD_ADDRESS');
  return value;
}

function fold(name: string, value: string): string {
  const words = value.split(/\s+/);
  let line = `${name}:`;
  const lines: string[] = [];
  for (const word of words) {
    if (line.length + word.length + 1 > 78) {
      lines.push(line);
      line = ` ${word}`;
    } else line += ` ${word}`;
  }
  lines.push(line);
  return lines.join('\r\n');
}

function encodedSubject(value: string): string {
  safeHeader(value);
  if (value.length <= 60 && /^[\x20-\x7e]*$/.test(value)) return value;
  const chunks: string[] = [];
  let bytes: number[] = [];
  for (const char of value) {
    const next = [...Buffer.from(char)];
    if (bytes.length + next.length > 45) {
      chunks.push(`=?UTF-8?B?${Buffer.from(bytes).toString('base64')}?=`);
      bytes = [];
    }
    bytes.push(...next);
  }
  if (bytes.length) chunks.push(`=?UTF-8?B?${Buffer.from(bytes).toString('base64')}?=`);
  return chunks.join(' ');
}

function base64Lines(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
}

export function buildMime(input: MimeInput): string {
  if (!input.to.length || input.to.length > 10 || (input.cc?.length ?? 0) + input.to.length > 10) throw new Error('BAD_ADDRESS');
  if ((input.attachments ?? []).reduce((size, part) => size + part.data.byteLength, 0) > 25 * 1024 * 1024) throw new Error('TOO_LARGE');
  const headers = [
    ...(input.from ? [fold('From', address(input.from))] : []),
    fold('To', input.to.map(address).join(', ')),
    ...(input.cc?.length ? [fold('Cc', input.cc.map(address).join(', '))] : []),
    fold('Subject', encodedSubject(input.subject)),
    ...(input.inReplyTo ? [fold('In-Reply-To', safeHeader(input.inReplyTo))] : []),
    ...(input.references?.length ? [fold('References', input.references.map(safeHeader).join(' '))] : []),
    'MIME-Version: 1.0',
  ];
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64Lines(Buffer.from(input.text, 'utf8'))].join('\r\n');
  const attachments = input.attachments ?? [];
  if (!attachments.length) return [...headers, textPart].join('\r\n') + '\r\n';
  const boundary = `ade_${randomBytes(16).toString('hex')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [textPart];
  for (const attachment of attachments) {
    safeHeader(attachment.filename);
    safeHeader(attachment.contentType);
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(attachment.contentType)) throw new Error('UNSUPPORTED_TYPE');
    const filename = `UTF-8''${encodeURIComponent(attachment.filename)}`;
    parts.push([
      `Content-Type: ${attachment.contentType}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename*=${filename}`,
      '',
      base64Lines(attachment.data),
    ].join('\r\n'));
  }
  return [...headers, '', ...parts.map((part) => `--${boundary}\r\n${part}`), `--${boundary}--`, ''].join('\r\n');
}
