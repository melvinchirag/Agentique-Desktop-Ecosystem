import { createServer, type Server } from 'node:http';
import type { Clock } from '../../runtime/types';

export const CONNECT_TIMEOUT_MS = 3 * 60 * 1000;

export class GoogleAuthError extends Error {
  constructor(public readonly code: 'CONNECT_TIMEOUT' | 'STATE_MISMATCH' | 'OAUTH_DENIED' | 'OAUTH_INVALID' | 'NOT_CONNECTED' | 'SCOPE_MISSING' | 'TOKEN_EXCHANGE_FAILED', public readonly missing?: string[]) {
    super(code);
    this.name = 'GoogleAuthError';
  }
}

export interface LoopbackReceiver {
  redirectUri: string;
  waitForCode: Promise<string>;
  close(): Promise<void>;
}

const page = '<!doctype html><html><body>Pixel is connected. You can close this tab.</body></html>';
const failurePage = '<!doctype html><html><body>Google connection failed. You can close this tab.</body></html>';

export async function startLoopback(state: string, clock: Clock): Promise<LoopbackReceiver> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  let timer: unknown;
  let closing: Promise<void> | null = null;
  const waitForCode = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // A browser can arrive before the caller awaits waitForCode. Attach a handler now.
  void waitForCode.catch(() => undefined);
  let server!: Server;
  const close = async (): Promise<void> => {
    clock.clearTimeout(timer);
    if (!closing) closing = server.listening
      ? new Promise<void>(resolve => server.close(() => resolve()))
      : Promise.resolve();
    await closing;
  };
  const settle = (result: string | GoogleAuthError): void => {
    if (settled) return;
    settled = true;
    void close();
    if (typeof result === 'string') resolveCode(result);
    else rejectCode(result);
  };
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth2callback') {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const receivedState = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (receivedState !== state) {
      response.writeHead(400).end(failurePage);
      settle(new GoogleAuthError('STATE_MISMATCH'));
    } else if (error) {
      response.writeHead(400).end(failurePage);
      settle(new GoogleAuthError('OAUTH_DENIED'));
    } else if (!code) {
      response.writeHead(400).end(failurePage);
      settle(new GoogleAuthError('OAUTH_INVALID'));
    } else {
      response.writeHead(200).end(page);
      settle(code);
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    server.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback address unavailable');
  timer = clock.setTimeout(() => settle(new GoogleAuthError('CONNECT_TIMEOUT')), CONNECT_TIMEOUT_MS);
  return { redirectUri: `http://127.0.0.1:${address.port}/oauth2callback`, waitForCode, close: async () => {
    if (!settled) settle(new GoogleAuthError('OAUTH_INVALID'));
    await close();
  } };
}
