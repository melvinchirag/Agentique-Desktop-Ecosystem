import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FakeClock } from '../../src/main/runtime/clock';
import { GOOGLE_SCOPES } from '../../src/main/connectors/google/auth';
import { startLoopback } from '../../src/main/connectors/google/loopback';
import { GoogleAuthService } from '../../src/main/connectors/google/googleAuthService';
import { DevFileTokenStore, MemoryTokenStore, SafeStorageTokenStore } from '../../src/main/connectors/google/tokenStore';

const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const fakeStorage = (available: boolean) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
  decryptString: (bytes: Buffer) => Buffer.from(bytes.toString().slice(7), 'base64').toString(),
});

describe('P1 OAuth loopback and token storage', () => {
  it('verifies state, sends the S256 verifier, stores only an encrypted refresh token, and returns the profile email', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixel-auth-')); created.push(dir);
    const path = join(dir, 'google-tokens.bin');
    const store = new SafeStorageTokenStore(fakeStorage(true), path);
    const clock = new FakeClock(0);
    let challenge = '';
    let state = '';
    const browser = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_SCOPES);
      challenge = parsed.searchParams.get('code_challenge')!;
      state = parsed.searchParams.get('state')!;
      expect(Buffer.from(state, 'base64url')).toHaveLength(16);
      const callback = parsed.searchParams.get('redirect_uri')!;
      expect(new URL(callback).hostname).toBe('127.0.0.1');
      const result = await globalThis.fetch(`${callback}?code=fake-code&state=${state}`);
      expect(result.status).toBe(200);
    });
    const endpoint = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/token')) {
        const form = new URLSearchParams(init?.body as URLSearchParams);
        expect(form.get('code')).toBe('fake-code');
        expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(challenge);
        return json({ access_token: 'access-secret', refresh_token: 'refresh-secret', scope: GOOGLE_SCOPES.join(' '), expires_in: 3600 });
      }
      expect(init?.headers).toEqual({ Authorization: 'Bearer access-secret' });
      return json({ emailAddress: 'demo@example.com' });
    }) as typeof fetch;
    const auth = new GoogleAuthService({ clientId: 'fake-id', store, fetch: endpoint, openExternal: browser, clock });
    expect(await auth.connect()).toEqual({ email: 'demo@example.com' });
    expect(await auth.getAccessToken()).toBe('access-secret');
    expect((await readFile(path, 'utf8'))).not.toContain('refresh-secret');
    expect((await readFile(path, 'utf8'))).not.toContain('access-secret');
    expect(await store.load()).toEqual({ refreshToken: 'refresh-secret', scopes: [...GOOGLE_SCOPES] });
    expect(browser).toHaveBeenCalledOnce();
    const port = Number(new URL(new URL(browser.mock.calls[0][0]).searchParams.get('redirect_uri')!).port);
    await expect(globalThis.fetch(`http://127.0.0.1:${port}/oauth2callback`)).rejects.toThrow();
  });

  it('rejects a mismatched state and closes the listener', async () => {
    const receiver = await startLoopback('expected', new FakeClock(0));
    expect((await globalThis.fetch(`${receiver.redirectUri}?code=abc&state=wrong`)).status).toBe(400);
    await expect(receiver.waitForCode).rejects.toMatchObject({ code: 'STATE_MISMATCH' });
    await expect(globalThis.fetch(receiver.redirectUri)).rejects.toThrow();
  });

  it('times out after three minutes and closes the listener', async () => {
    const clock = new FakeClock(0);
    const receiver = await startLoopback('expected', clock);
    clock.advance(179_999);
    expect(clock.pending()).toBe(1);
    clock.advance(1);
    await expect(receiver.waitForCode).rejects.toMatchObject({ code: 'CONNECT_TIMEOUT' });
    await expect(globalThis.fetch(receiver.redirectUri)).rejects.toThrow();
  });

  it('keeps tokens in memory if encryption is unavailable and forbids packaged dev storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixel-auth-')); created.push(dir);
    const path = join(dir, 'tokens.bin');
    const store = new SafeStorageTokenStore(fakeStorage(false), path);
    await store.save({ refreshToken: 'refresh-secret', scopes: [...GOOGLE_SCOPES] });
    expect(await store.load()).toMatchObject({ refreshToken: 'refresh-secret' });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => new DevFileTokenStore({ projectRoot: dir, isPackaged: true })).toThrow(/packaged/);
    const dev = new DevFileTokenStore({ projectRoot: dir, isPackaged: false });
    await dev.save({ refreshToken: 'dev-only', scopes: [] });
    expect(await dev.load()).toMatchObject({ refreshToken: 'dev-only' });
    await dev.clear();
    expect(await dev.load()).toBeNull();
  });

  it('rejects missing consent scopes before storing credentials', async () => {
    const store = new MemoryTokenStore();
    const browser = async (url: string) => {
      const parsed = new URL(url);
      const callback = parsed.searchParams.get('redirect_uri')!;
      await globalThis.fetch(`${callback}?code=fake&state=${parsed.searchParams.get('state')}`);
    };
    const endpoint = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('/token');
      return json({ access_token: 'access', refresh_token: 'refresh', scope: GOOGLE_SCOPES[0] });
    });
    const auth = new GoogleAuthService({ clientId: 'fake', store, fetch: endpoint as typeof fetch, openExternal: browser, clock: new FakeClock(0) });
    await expect(auth.connect()).rejects.toMatchObject({ code: 'SCOPE_MISSING', missing: GOOGLE_SCOPES.slice(1) });
    expect(await store.load()).toBeNull();
    expect(endpoint).toHaveBeenCalledOnce();
  });
});

describe('P2 refresh and scope handling', () => {
  it('shares one refresh among five concurrent callers and retries one 401', async () => {
    const store = new MemoryTokenStore();
    await store.save({ refreshToken: 'refresh', scopes: [...GOOGLE_SCOPES] });
    const clock = new FakeClock(0);
    let refreshes = 0;
    let requests = 0;
    const endpoint = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/token')) {
        refreshes++;
        return json({ access_token: refreshes === 1 ? 'first' : 'second', expires_in: 3600 });
      }
      requests++;
      expect((init?.headers as Headers).get('Authorization')).toBe(requests === 1 ? 'Bearer first' : 'Bearer second');
      return requests === 1 ? new Response('', { status: 401 }) : json({ ok: true });
    }) as typeof fetch;
    const auth = new GoogleAuthService({ clientId: 'fake', store, fetch: endpoint, openExternal: async () => {}, clock });
    expect(await Promise.all(Array.from({ length: 5 }, () => auth.getAccessToken()))).toEqual(Array(5).fill('first'));
    expect(refreshes).toBe(1);
    expect((await auth.authorizedFetch('https://google.test/data')).status).toBe(200);
    expect(refreshes).toBe(2);
    expect(requests).toBe(2);
  });

  it('clears invalid_grant, signals reconnect, and rejects missing scopes', async () => {
    const store = new MemoryTokenStore();
    await store.save({ refreshToken: 'refresh', scopes: [...GOOGLE_SCOPES] });
    const reconnect = vi.fn();
    const email = vi.fn();
    const auth = new GoogleAuthService({
      clientId: 'fake', store, clock: new FakeClock(0), openExternal: async () => {},
      onNeedsReconnect: reconnect, onEmailChange: email,
      fetch: vi.fn(async () => json({ error: 'invalid_grant' }, 400)) as typeof fetch,
    });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    expect(reconnect).toHaveBeenCalledOnce();
    expect(email).toHaveBeenCalledWith(undefined);
    expect(await store.load()).toBeNull();
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await store.save({ refreshToken: 'refresh', scopes: [GOOGLE_SCOPES[0]] });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'SCOPE_MISSING', missing: GOOGLE_SCOPES.slice(1) });
  });
});

describe('P35 disconnect', () => {
  it('revokes the refresh token, clears credentials and email, and leaves other user state untouched', async () => {
    const store = new MemoryTokenStore();
    await store.save({ refreshToken: 'refresh', scopes: [...GOOGLE_SCOPES] });
    const email = vi.fn();
    const endpoint = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('', { status: 200 }));
    const auth = new GoogleAuthService({ clientId: 'fake', store, fetch: endpoint as typeof fetch, openExternal: async () => {}, clock: new FakeClock(0), onEmailChange: email });
    await auth.disconnect();
    expect(endpoint).toHaveBeenCalledOnce();
    expect(String(endpoint.mock.calls[0][0])).toBe('https://oauth2.googleapis.com/revoke');
    expect(new URLSearchParams(endpoint.mock.calls[0][1]?.body as URLSearchParams).get('token')).toBe('refresh');
    expect(await store.load()).toBeNull();
    expect(email).toHaveBeenCalledWith(undefined);
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });
});
