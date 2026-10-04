import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../src/main/runtime/clock';
import { GoogleHttp, GoogleHttpError } from '../../src/main/connectors/google/http';

const route = 'https://gmail.googleapis.com/gmail/v1/users/me/profile?secret=query';
const response = (status: number, headers?: HeadersInit) => new Response('{}', { status, headers });

describe('GoogleHttp P2/P3/P31', () => {
  it('blocks before requesting a token or touching the network', async () => {
    const fetcher = vi.fn();
    const getAccessToken = vi.fn(async () => 'token');
    const http = new GoogleHttp({ fetch: fetcher, getAccessToken, refreshAccessToken: async () => 'new' });
    await expect(http.request('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send')).rejects.toMatchObject({ code: 'BLOCKED_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes once after 401 and logs only method, path and status', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200));
    const refreshAccessToken = vi.fn(async () => 'fresh');
    const log = vi.fn();
    const http = new GoogleHttp({ fetch: fetcher, getAccessToken: async () => 'old', refreshAccessToken, log });
    expect((await http.request('GET', route)).status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(new Headers(fetcher.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer fresh');
    expect(log.mock.calls).toEqual([
      [{ method: 'GET', path: '/gmail/v1/users/me/profile', status: 401 }],
      [{ method: 'GET', path: '/gmail/v1/users/me/profile', status: 200 }],
    ]);
  });

  it('honors Retry-After on 429 and stops after three 5xx responses', async () => {
    const clock = new FakeClock(0);
    const fetcher = vi.fn().mockResolvedValueOnce(response(429, { 'Retry-After': '2' })).mockResolvedValueOnce(response(200));
    const http = new GoogleHttp({ fetch: fetcher, clock, random: () => 0, getAccessToken: async () => 'a', refreshAccessToken: async () => 'b' });
    const pending = http.request('GET', route);
    await Promise.resolve(); await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await clock.advanceAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await clock.advanceAsync(1);
    expect((await pending).status).toBe(200);
    const down = new GoogleHttp({ fetch: vi.fn().mockResolvedValue(response(503)), clock, random: () => 0, getAccessToken: async () => 'a', refreshAccessToken: async () => 'b' });
    const failure = down.request('GET', route);
    const outcome = expect(failure).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 } satisfies Partial<GoogleHttpError>);
    await clock.advanceAsync(5000);
    await outcome;
  });

  it('times out a hung request at 15 seconds', async () => {
    const clock = new FakeClock(0);
    const fetcher = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const http = new GoogleHttp({ fetch: fetcher, clock, getAccessToken: async () => 'a', refreshAccessToken: async () => 'b' });
    const pending = http.request('GET', route);
    const outcome = expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await clock.advanceAsync(15_000);
    await outcome;
  });
});
