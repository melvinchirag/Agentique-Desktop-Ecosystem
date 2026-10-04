/** Redaction happens before either sampling or statistics leave this module. */
export function redact(text: string, recipientName?: string): string {
  let safe = text
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, '<url>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '<phone>')
    .replace(/\b\d{4,}\b/g, '<number>');
  if (recipientName) {
    const names = recipientName.split(/\s+/).filter(part => part.length > 1);
    for (const name of [recipientName, ...names]) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      safe = safe.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '<name>');
    }
  }
  return safe.replace(/(?:<name>\s+){1,}<name>/g, '<name>');
}

export function recipientFromHeaders(headers: Record<string, string>): string | undefined {
  const to = Object.entries(headers).find(([key]) => key.toLowerCase() === 'to')?.[1];
  const display = to?.match(/(?:^|,)\s*(?:"([^"]+)"|([^<,]+))\s*<[^>]+>/)?.[1]
    ?? to?.match(/(?:^|,)\s*(?:"([^"]+)"|([^<,]+))\s*<[^>]+>/)?.[2];
  return display?.trim() || undefined;
}
