import type { CleanedEmail } from './types';
import { wordCount } from './cleaner';

export function sampleEmails(emails: CleanedEmail[], limit = 30): string[] {
  const groups = new Map<string, CleanedEmail[]>();
  for (const email of [...emails].sort((a, b) => b.internalDate - a.internalDate)) {
    const key = email.greeting?.toLowerCase() ?? '(none)';
    const group = groups.get(key) ?? [];
    group.push(email);
    groups.set(key, group);
  }
  const picked: CleanedEmail[] = [];
  while (picked.length < Math.min(limit, emails.length)) {
    let added = false;
    for (const group of groups.values()) {
      const email = group.shift();
      if (email) { picked.push(email); added = true; }
      if (picked.length >= limit) break;
    }
    if (!added) break;
  }
  return picked.map(email => {
    const tokens = email.text.split(/\s+/).filter(Boolean);
    const excerpt = tokens.length > 150 ? [...tokens.slice(0, 120), '[…]', ...tokens.slice(-30)] : tokens;
    const result = excerpt.join(' ');
    return wordCount(result) <= 151 ? result : result.split(/\s+/).slice(0, 151).join(' ');
  });
}
