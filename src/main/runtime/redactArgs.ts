/** Copy tool arguments for bus/Tiger without exposing mail, document text, or addresses. */
export function redactEventArgs(value: unknown): unknown {
  const sensitive = /^(body|body_markdown|description)$/i;
  const address = /^(recipients|cc_recipients|attendees|email|reply_to)$/i;
  const walk = (item: unknown, key = ''): unknown => {
    if (sensitive.test(key)) return typeof item === 'string' ? `‹${item.length} chars›` : '[redacted]';
    if (address.test(key)) return Array.isArray(item) ? `‹${item.length} recipients›` : '[redacted]';
    if (typeof item === 'string') return item.length > 120 ? `‹${item.length} chars›` : item;
    if (Array.isArray(item)) return item.map(entry => walk(entry, key));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, walk(v, k)]));
    return item;
  };
  return walk(value);
}
