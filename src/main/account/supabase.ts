import { ACCOUNT } from './account.config';

export const ACCOUNT_ERRORS = {
  code: 'That code was not accepted',
  network: 'Could not reach the sign-in service',
  rate: 'Too many attempts, wait a minute',
} as const;

export interface Session { accessToken: string; refreshToken: string; expiresAt: number; userId: string }
export interface InstallRow { user_id: string; device_id: string; app_version: string; os: 'windows'; last_seen: string }

export class SupabaseAccountClient {
  constructor(private readonly config = ACCOUNT, private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now) {}

  private async request(path: string, body: object, accessToken?: string, codeRequest = false): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.url.replace(/\/$/, '')}${path}`, {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: {
          'Content-Type': 'application/json', apikey: this.config.anonKey,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(path.startsWith('/rest/') ? { Prefer: 'resolution=merge-duplicates' } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch { throw new Error(ACCOUNT_ERRORS.network); }
    if (response.status === 429) throw new Error(ACCOUNT_ERRORS.rate);
    if (!response.ok) throw new Error(codeRequest && response.status >= 400 && response.status < 500
      ? ACCOUNT_ERRORS.code : ACCOUNT_ERRORS.network);
    try { return response.status === 204 ? null : await response.json(); }
    catch { return null; }
  }

  async sendCode(email: string): Promise<void> {
    await this.request('/auth/v1/otp', { email, create_user: true });
  }

  async verifyCode(email: string, token: string): Promise<Session> {
    return this.toSession(await this.request('/auth/v1/verify', { type: 'email', email, token }, undefined, true), true);
  }

  async refresh(refreshToken: string): Promise<Session> {
    return this.toSession(await this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken }), false);
  }

  async upsertInstall(session: Session, row: InstallRow): Promise<void> {
    await this.request('/rest/v1/installs?on_conflict=user_id,device_id', row, session.accessToken);
  }

  private toSession(value: unknown, codeRequest: boolean): Session {
    const data = value as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; user?: { id?: unknown } } | null;
    if (typeof data?.access_token !== 'string' || typeof data.refresh_token !== 'string' ||
      typeof data.expires_in !== 'number' || typeof data.user?.id !== 'string') {
      throw new Error(codeRequest ? ACCOUNT_ERRORS.code : ACCOUNT_ERRORS.network);
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token,
      expiresAt: this.now() + data.expires_in * 1000, userId: data.user.id };
  }
}
