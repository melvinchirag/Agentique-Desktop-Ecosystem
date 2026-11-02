import { describe, expect, it } from 'vitest';
import { accountEnabled } from './flags';

describe('account gate', () => {
  it('skips the sign-in flow until both config fields are filled', () => {
    expect(accountEnabled({ url: '', anonKey: '' }, {})).toBe(false);
    expect(accountEnabled({ url: 'https://example.co', anonKey: '' }, {})).toBe(false);
    expect(accountEnabled({ url: 'https://example.co', anonKey: 'public' }, { ADE_ACCOUNT: 'off' })).toBe(false);
    expect(accountEnabled({ url: 'https://example.co', anonKey: 'public' }, {})).toBe(true);
  });
});
