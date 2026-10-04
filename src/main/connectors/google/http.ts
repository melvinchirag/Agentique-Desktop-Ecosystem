import { assertGoogleAllowed } from './allowlist';
import type { Clock, TimerHandle } from '../../runtime/types';

export type GoogleHttpErrorCode = 'NOT_CONNECTED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'NOT_FOUND' | 'GOOGLE_HTTP_ERROR';
export class GoogleHttpError extends Error {
  constructor(readonly code: GoogleHttpErrorCode, readonly status?: number) { super(code); }
}

export interface GoogleHttpOptions {
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
  clock?: Pick<Clock, 'now' | 'setTimeout' | 'clearTimeout'>;
  random?: () => number;
  log?: (entry: { method: string; path: string; status: number }) => void;
}

const realClock: Pick<Clock, 'now' | 'setTimeout' | 'clearTimeout'> = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class GoogleHttp {
  private readonly fetcher: typeof fetch;
  private readonly clock: Pick<Clock, 'now' | 'setTimeout' | 'clearTimeout'>;
  constructor(private readonly options: GoogleHttpOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.clock = options.clock ?? realClock;
  }

  async request(method: string, input: string | URL, init: Omit<RequestInit, 'method' | 'signal'> = {}): Promise<Response> {
    const url = assertGoogleAllowed(method, input);
    let token = await this.options.getAccessToken();
    if (!token) throw new GoogleHttpError('NOT_CONNECTED');
    let refreshed = false;
    let attempts = 0;
    while (true) {
      attempts++;
      const controller = new AbortController();
      const timer = this.clock.setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${token}`);
        response = await this.fetcher(url, { ...init, method, headers, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw new GoogleHttpError('UNAVAILABLE');
        throw error;
      } finally {
        this.clock.clearTimeout(timer);
      }
      this.options.log?.({ method: method.toUpperCase(), path: url.pathname, status: response.status });
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.options.refreshAccessToken();
        if (!token) throw new GoogleHttpError('NOT_CONNECTED', 401);
        attempts--; // one auth retry does not consume a rate-limit retry
        continue;
      }
      if (response.status === 401) throw new GoogleHttpError('NOT_CONNECTED', 401);
      if (response.status === 404) throw new GoogleHttpError('NOT_FOUND', 404);
      if (response.status === 429 || response.status >= 500) {
        const code = response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE';
        if (attempts >= 3) throw new GoogleHttpError(code, response.status);
        await this.sleep(this.retryDelay(response, attempts));
        continue;
      }
      if (!response.ok) throw new GoogleHttpError('GOOGLE_HTTP_ERROR', response.status);
      return response;
    }
  }

  private retryDelay(response: Response, attempts: number): number {
    const value = response.headers.get('Retry-After');
    const seconds = value === null ? NaN : Number(value);
    const date = value === null ? NaN : Date.parse(value);
    const retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
      : Number.isFinite(date) ? Math.max(0, date - this.clock.now()) : 0;
    const jitter = Math.max(0, Math.min(1, this.options.random?.() ?? Math.random()));
    return Math.max(retryAfter, 500 * 2 ** (attempts - 1) * (0.5 + jitter));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => { this.clock.setTimeout(resolve, ms); });
  }
}
