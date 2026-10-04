import type { Clock } from '../../runtime/types';
import { GOOGLE_SCOPES, authorizationUrl, createPkceChallenge, missingScopes } from './auth';
import { GoogleAuthError, startLoopback, type LoopbackReceiver } from './loopback';
import type { StoredGoogleTokens, TokenStore } from './tokenStore';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

export interface GoogleAuthDependencies {
  clientId: string;
  clientSecret?: string;
  store: TokenStore;
  fetch: typeof fetch;
  openExternal: (url: string) => Promise<void>;
  clock: Clock;
  onNeedsReconnect?: () => void;
  onEmailChange?: (email: string | undefined) => void | Promise<void>;
}

/** OAuth token exchange uses injected fetch: this checkout does not depend on google-auth-library. */
export class GoogleAuthService {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshFlight: Promise<string> | null = null;
  private connectFlight: Promise<{ email: string }> | null = null;
  private generation = 0;

  constructor(private readonly deps: GoogleAuthDependencies) {}

  connect(): Promise<{ email: string }> {
    if (this.connectFlight) return this.connectFlight;
    const flight = this.connectImpl();
    this.connectFlight = flight;
    void flight.finally(() => { if (this.connectFlight === flight) this.connectFlight = null; }).catch(() => undefined);
    return flight;
  }

  private async connectImpl(): Promise<{ email: string }> {
    const { verifier, challenge, state } = createPkceChallenge();
    const receiver = await startLoopback(state, this.deps.clock);
    try {
      await this.deps.openExternal(authorizationUrl({
        clientId: this.deps.clientId, redirectUri: receiver.redirectUri, challenge, state,
      }));
      const code = await receiver.waitForCode;
      const response = await this.tokenRequest({
        client_id: this.deps.clientId,
        client_secret: this.deps.clientSecret ?? '',
        code,
        code_verifier: verifier,
        redirect_uri: receiver.redirectUri,
        grant_type: 'authorization_code',
      });
      if (!response.access_token || !response.refresh_token) throw new GoogleAuthError('TOKEN_EXCHANGE_FAILED');
      const missing = missingScopes(response.scope ?? '');
      if (missing.length) throw new GoogleAuthError('SCOPE_MISSING', missing);
      const profile = await this.deps.fetch(PROFILE_URL, {
        headers: { Authorization: `Bearer ${response.access_token}` },
      });
      if (!profile.ok) throw new GoogleAuthError('TOKEN_EXCHANGE_FAILED');
      const data: unknown = await profile.json();
      const email = (data as { emailAddress?: unknown }).emailAddress;
      if (typeof email !== 'string' || !email) throw new GoogleAuthError('TOKEN_EXCHANGE_FAILED');
      const stored: StoredGoogleTokens = { refreshToken: response.refresh_token, scopes: response.scope!.split(/\s+/).filter(Boolean) };
      await this.deps.store.save(stored);
      this.generation++;
      this.cacheAccessToken(response);
      await this.deps.onEmailChange?.(email);
      return { email };
    } finally {
      await receiver.close();
    }
  }

  async getAccessToken(requiredScopes: readonly string[] = GOOGLE_SCOPES): Promise<string> {
    const stored = await this.deps.store.load();
    if (!stored) throw new GoogleAuthError('NOT_CONNECTED');
    const missing = missingScopes(stored.scopes, requiredScopes);
    if (missing.length) throw new GoogleAuthError('SCOPE_MISSING', missing);
    if (this.accessToken && this.deps.clock.now() < this.expiresAt - 30_000) return this.accessToken;
    return this.refresh(stored);
  }

  async forceRefreshAccessToken(): Promise<string> {
    const stored = await this.deps.store.load();
    if (!stored) throw new GoogleAuthError('NOT_CONNECTED');
    return this.refresh(stored, this.accessToken ?? undefined);
  }

  /** Fetch an authenticated Google URL, retrying one 401 after a shared refresh. */
  async authorizedFetch(url: string, init: RequestInit = {}, requiredScopes: readonly string[] = GOOGLE_SCOPES): Promise<Response> {
    const firstToken = await this.getAccessToken(requiredScopes);
    let response = await this.withBearer(url, init, firstToken);
    if (response.status === 401) {
      const stored = await this.deps.store.load();
      if (!stored) throw new GoogleAuthError('NOT_CONNECTED');
      const token = await this.refresh(stored, firstToken);
      response = await this.withBearer(url, init, token);
    }
    return response;
  }

  private withBearer(url: string, init: RequestInit, token: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return this.deps.fetch(url, { ...init, headers });
  }

  private refresh(stored: StoredGoogleTokens, staleToken?: string): Promise<string> {
    if (this.refreshFlight) return this.refreshFlight;
    // A different request may already have replaced the token while this caller was in flight.
    if (staleToken && this.accessToken && this.accessToken !== staleToken) return Promise.resolve(this.accessToken);
    const generation = this.generation;
    const flight = (async () => {
      const response = await this.tokenRequest({
        client_id: this.deps.clientId,
        client_secret: this.deps.clientSecret ?? '',
        refresh_token: stored.refreshToken,
        grant_type: 'refresh_token',
      });
      if (generation !== this.generation) throw new GoogleAuthError('NOT_CONNECTED');
      if (!response.access_token) throw new GoogleAuthError('TOKEN_EXCHANGE_FAILED');
      if (response.scope) {
        const missing = missingScopes(response.scope);
        if (missing.length) throw new GoogleAuthError('SCOPE_MISSING', missing);
        await this.deps.store.save({ refreshToken: response.refresh_token ?? stored.refreshToken, scopes: response.scope.split(/\s+/).filter(Boolean) });
      } else if (response.refresh_token) {
        await this.deps.store.save({ ...stored, refreshToken: response.refresh_token });
      }
      this.cacheAccessToken(response);
      return response.access_token;
    })();
    this.refreshFlight = flight;
    void flight.finally(() => { if (this.refreshFlight === flight) this.refreshFlight = null; }).catch(() => undefined);
    return flight;
  }

  private cacheAccessToken(response: TokenResponse): void {
    this.accessToken = response.access_token ?? null;
    this.expiresAt = this.deps.clock.now() + Math.max(0, response.expires_in ?? 3600) * 1000;
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const response = await this.deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    let data: TokenResponse;
    try { data = await response.json() as TokenResponse; }
    catch { throw new GoogleAuthError('TOKEN_EXCHANGE_FAILED'); }
    if (data.error === 'invalid_grant' && params.grant_type === 'refresh_token') {
      await this.clearLocal(true);
      throw new GoogleAuthError('NOT_CONNECTED');
    }
    if (!response.ok || data.error) throw new GoogleAuthError('TOKEN_EXCHANGE_FAILED');
    return data;
  }

  async disconnect(): Promise<void> {
    const stored = await this.deps.store.load();
    try {
      if (stored) await this.deps.fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: stored.refreshToken }),
      });
    } finally {
      await this.clearLocal(false);
    }
  }

  private async clearLocal(notify: boolean): Promise<void> {
    this.generation++;
    this.accessToken = null;
    this.expiresAt = 0;
    await this.deps.store.clear();
    await this.deps.onEmailChange?.(undefined);
    if (notify) this.deps.onNeedsReconnect?.();
  }
}
