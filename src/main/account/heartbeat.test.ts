import { describe, expect, it, vi } from 'vitest';
import { AccountHeartbeat, DAY_MS } from './heartbeat';
import type { AccountStore } from './store';
import type { SupabaseAccountClient } from './supabase';

describe('account heartbeat', () => {
  it('upserts the allowed fields on launch and no more than once per 24 hours', async () => {
    let now = Date.parse('2026-11-02T12:00:00Z');
    const account = { userId: 'user-id', email: 'person@example.com', accessToken: 'access', refreshToken: 'refresh', expiresAt: now + DAY_MS * 2, deviceId: 'device-id' };
    const store = { load: vi.fn(async () => account), save: vi.fn() } as unknown as AccountStore;
    const upsertInstall = vi.fn(async () => undefined);
    const client = { upsertInstall, refresh: vi.fn() } as unknown as SupabaseAccountClient;
    const heartbeat = new AccountHeartbeat(store, client, '0.2.0', () => now);
    await heartbeat.tick();
    expect(upsertInstall).toHaveBeenCalledWith(account, {
      user_id: 'user-id', device_id: 'device-id', app_version: '0.2.0', os: 'windows', last_seen: '2026-11-02T12:00:00.000Z',
    });
    now += DAY_MS - 1;
    await heartbeat.tick();
    expect(upsertInstall).toHaveBeenCalledOnce();
    now += 1;
    await heartbeat.tick();
    expect(upsertInstall).toHaveBeenCalledTimes(2);
  });

  it('refreshes an expired token before writing and logs a failure only once', async () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    const account = { userId: 'user-id', email: 'person@example.com', accessToken: 'old', refreshToken: 'old-refresh', expiresAt: now, deviceId: 'device-id' };
    const save = vi.fn(async () => undefined);
    const store = { load: vi.fn(async () => account), save } as unknown as AccountStore;
    const refresh = vi.fn(async () => ({ userId: 'user-id', accessToken: 'new', refreshToken: 'new-refresh', expiresAt: now + DAY_MS }));
    const upsertInstall = vi.fn(async () => undefined);
    const client = { refresh, upsertInstall } as unknown as SupabaseAccountClient;
    const heartbeat = new AccountHeartbeat(store, client, '0.2.0', () => now);
    await heartbeat.tick();
    expect(refresh).toHaveBeenCalledWith('old-refresh');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new', deviceId: 'device-id' }));
    expect(upsertInstall).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new' }), expect.anything());
    upsertInstall.mockRejectedValue(new Error('secret response'));
    const log = vi.fn();
    const failing = new AccountHeartbeat(store, client, '0.2.0', () => now, log);
    await failing.tick(); await failing.tick();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).not.toContain('secret response');
  });
  it('waits for an in-flight write before sign-out can clear the session', async () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    const account = { userId: 'user-id', email: 'person@example.com', accessToken: 'access', refreshToken: 'refresh', expiresAt: now + DAY_MS, deviceId: 'device-id' };
    const store = { load: vi.fn(async () => account) } as unknown as AccountStore;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const client = { upsertInstall: vi.fn(() => pending) } as unknown as SupabaseAccountClient;
    const heartbeat = new AccountHeartbeat(store, client, '0.2.0', () => now);
    const tick = heartbeat.tick();
    await vi.waitFor(() => expect(client.upsertInstall).toHaveBeenCalledOnce());
    let stopped = false;
    const stop = heartbeat.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await Promise.all([tick, stop]);
    expect(stopped).toBe(true);
  });
});
