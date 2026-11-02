import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_ERRORS, SupabaseAccountClient } from './supabase';

const config = { url: 'https://example.supabase.co', anonKey: 'public-test-key' };
const session = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: 'user-id' } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('Supabase account client', () => {
  it('sends the email OTP request with the anon key and 15 second timeout', async () => {
    const fetchFn = vi.fn(async () => json({}));
    const client = new SupabaseAccountClient(config, fetchFn as typeof fetch);
    await client.sendCode('person@example.com');
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, options] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${config.url}/auth/v1/otp`);
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({ apikey: config.anonKey, 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body as string)).toEqual({ email: 'person@example.com', create_user: true });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('verifies a code and retains tokens only in the main-process result', async () => {
    const fetchFn = vi.fn(async () => json(session));
    const client = new SupabaseAccountClient(config, fetchFn as typeof fetch, () => 1000);
    expect(await client.verifyCode('person@example.com', '123456')).toEqual({
      accessToken: 'access', refreshToken: 'refresh', expiresAt: 3601000, userId: 'user-id',
    });
    const [url, options] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${config.url}/auth/v1/verify`);
    expect(JSON.parse(options.body as string)).toEqual({ type: 'email', email: 'person@example.com', token: '123456' });
  });

  it('maps a rejected code, a rate limit, and network failure', async () => {
    await expect(new SupabaseAccountClient(config, async () => json({}, 403)).verifyCode('a@b.co', '123456'))
      .rejects.toThrow(ACCOUNT_ERRORS.code);
    await expect(new SupabaseAccountClient(config, async () => json({}, 429)).sendCode('a@b.co'))
      .rejects.toThrow(ACCOUNT_ERRORS.rate);
    await expect(new SupabaseAccountClient(config, async () => { throw new Error('offline'); }).sendCode('a@b.co'))
      .rejects.toThrow(ACCOUNT_ERRORS.network);
  });

  it('uses the refresh grant path and bearer token for an install upsert', async () => {
    const fetchFn = vi.fn(async (url: string) => url.includes('/token?') ? json(session) : json(null, 201));
    const client = new SupabaseAccountClient(config, fetchFn as typeof fetch);
    await client.refresh('old-refresh');
    const [refreshUrl, refreshOptions] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(refreshUrl).toBe(`${config.url}/auth/v1/token?grant_type=refresh_token`);
    expect(JSON.parse(refreshOptions.body as string)).toEqual({ refresh_token: 'old-refresh' });
    const row = { user_id: 'user-id', device_id: 'device-id', app_version: '0.2.0', os: 'windows' as const, last_seen: '2026-11-02T00:00:00.000Z' };
    await client.upsertInstall({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 1, userId: 'user-id' }, row);
    const [upsertUrl, upsertOptions] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(upsertUrl).toContain('/rest/v1/installs?on_conflict=user_id,device_id');
    expect(upsertOptions.headers).toMatchObject({ Authorization: 'Bearer access', Prefer: 'resolution=merge-duplicates' });
    expect(JSON.parse(upsertOptions.body as string)).toEqual(row);
  });
});
