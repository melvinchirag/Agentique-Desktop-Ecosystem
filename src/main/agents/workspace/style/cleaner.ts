import type { GmailMessage } from '../../../connectors/google/api';
import type { CleanedEmail } from './types';
import { recipientFromHeaders } from './redact';

const words = (text: string) => text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu)?.length ?? 0;
export { words as wordCount };

function header(message: GmailMessage, key: string): string | undefined {
  return Object.entries(message.headers).find(([name]) => name.toLowerCase() === key)?.[1];
}

function htmlToText(html: string): string {
  return html.split(/<[^>]+class=["'][^"']*\bgmail_quote\b[^"']*["'][^>]*>/i)[0]!
    .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (/^\s*>/.test(lines[i]!) || /^On .{3,} wrote:$/i.test(line)
      || /^-{2,}\s*(?:original message|forwarded message)\s*-{2,}$/i.test(line)
      || /^Begin forwarded message:/i.test(line)
      || (/^From:\s/i.test(line) && lines.slice(i + 1, i + 5).some(next => /^(?:Sent|To|Subject):\s/i.test(next.trim())))) break;
    kept.push(lines[i]!);
  }
  return kept.join('\n').replace(/\n?Sent from my (?:iPhone|iPad|Android|mobile device)[^\n]*[\s\S]*$/i, '').trim();
}

function trailingSignature(text: string): string | undefined {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 3) return undefined;
  const tail = lines.slice(-2).join('\n');
  return tail.length <= 100 ? tail : undefined;
}

export function cleanEmails(messages: GmailMessage[]): CleanedEmail[] {
  const candidates = messages.flatMap(message => {
    if (header(message, 'auto-submitted') || /bulk|list|junk/i.test(header(message, 'precedence') ?? '') || header(message, 'list-id')) return [];
    const text = stripQuoted(message.textBody?.trim() || htmlToText(message.htmlBody ?? ''));
    if (!text) return [];
    return [{ message, text }];
  });
  const signatures = new Map<string, number>();
  for (const { text } of candidates) {
    const tail = trailingSignature(text);
    if (tail) signatures.set(tail, (signatures.get(tail) ?? 0) + 1);
  }
  return candidates.flatMap(({ message, text }) => {
    const signature = trailingSignature(text);
    if (signature && (signatures.get(signature) ?? 0) >= 3) text = text.slice(0, -signature.length).trim();
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const greeting = /^(?:hi|hey|hello|dear|good (?:morning|afternoon|evening))\b/i.test(lines[0] ?? '') ? lines.shift() : undefined;
    let signoff: string | undefined;
    const signoffIndex = lines.findLastIndex(line => /^(?:thanks(?: again| so much)?[!,]?|best(?: regards)?[,]?|sincerely[,]?|cheers[,]?|regards[,]?)$/i.test(line));
    if (signoffIndex >= Math.max(0, lines.length - 3)) {
      signoff = lines.slice(signoffIndex).join('\n');
      lines.splice(signoffIndex);
    } else if (signature) signoff = signature;
    const body = [greeting, ...lines].filter(Boolean).join('\n');
    if (words(body) < 15) return [];
    return [{ text: body, greeting, signoff, recipientName: recipientFromHeaders(message.headers), isReply: /^re:/i.test(message.subject), internalDate: message.internalDate }];
  });
}
