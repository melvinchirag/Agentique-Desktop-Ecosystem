/**
 * The egress allow list: every connection ADE itself makes is to a named host on this list, or it is
 * refused and written to the audit log. Every network call in the main process goes through the global
 * `fetch`, so one guard on it covers Backboard, ElevenLabs, Google and the ADE account service. The CLI
 * brains (Claude Code, Codex, Gemini) are separate programs the user installed; they connect to their own
 * vendor under the user's own sign-in, which ADE neither proxies nor inspects.
 *
 * The renderers already cannot reach the network (CSP connect-src 'self'). Tiger (off by default) uses a
 * database socket, not fetch; it stays named here for honesty.
 */
import { ACCOUNT } from './account/account.config';

export interface EgressEntry { host: string; why: string }

/** Hosts ADE may contact, with the reason shown to the user. A suffix match ("*.googleapis.com") covers Google's API hosts. */
export function egressList(): EgressEntry[] {
  const list: EgressEntry[] = [
    { host: 'app.backboard.io', why: 'Backboard: the AI service when Backboard is the brain, and document indexing for Word, slides and sheets' },
    { host: 'api.elevenlabs.io', why: 'ElevenLabs: voices and speech-to-text, only with your own key' },
    { host: 'accounts.google.com', why: 'Google sign-in for Pixel (Gmail, Calendar, Drive)' },
    { host: 'oauth2.googleapis.com', why: 'Google sign-in tokens for Pixel' },
    { host: '*.googleapis.com', why: 'Gmail, Calendar, Drive, Docs and Sheets, only after you connect Google' },
  ];
  try { const host = new URL(ACCOUNT.url).host; if (host) list.push({ host, why: 'ADE account: sign-in code, install and weekly-use counts' }); } catch { /* no account service configured */ }
  return list;
}

export const hostAllowed = (host: string, entries: EgressEntry[] = egressList()): boolean => {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.startsWith('127.')) return true;   // Google's loopback redirect, dev server
  return entries.some((e) => e.host.startsWith('*.') ? h.endsWith(e.host.slice(1)) || h === e.host.slice(2) : h === e.host);
};

export interface EgressGuard { uninstall(): void; denied: { ts: number; host: string }[]; onDeny?: (host: string, url: string) => void }

let installed: EgressGuard | undefined;
let pendingReporter: ((host: string, url: string) => void) | undefined;
/** The core registers here so a denial lands in the audit log (wolf.alert) even though the guard was installed before the core existed. */
export function onEgressDenied(cb: (host: string, url: string) => void): void {
  pendingReporter = cb;
  if (installed) installed.onDeny = cb;
}

/** Wraps the global fetch. A request to a host outside the list throws EGRESS_DENIED and is reported through onDeny. */
export function installEgressGuard(opts: { allowed?: () => EgressEntry[]; fetchImpl?: typeof fetch; target?: { fetch: typeof fetch } } = {}): EgressGuard {
  const target = opts.target ?? (globalThis as { fetch: typeof fetch });
  const original = opts.fetchImpl ?? target.fetch;
  const guard: EgressGuard = { denied: [], uninstall: () => { target.fetch = original; } };
  const guarded: typeof fetch = (input, init) => {
    let host = '';
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return original(input, init);
      host = parsed.host.replace(/:\d+$/, '');
      if (!hostAllowed(host, opts.allowed ? opts.allowed() : egressList())) {
        guard.denied.push({ ts: Date.now(), host });
        guard.onDeny?.(host, parsed.origin);
        return Promise.reject(new Error(`EGRESS_DENIED: ADE does not connect to ${host}`));
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('EGRESS_DENIED')) return Promise.reject(error);
      // Unparseable input: let fetch produce its own error.
    }
    return original(input, init);
  };
  target.fetch = guarded;
  if (!opts.target) { installed = guard; if (pendingReporter) guard.onDeny = pendingReporter; }
  return guard;
}
