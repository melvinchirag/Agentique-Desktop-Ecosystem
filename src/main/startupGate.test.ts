import { describe, expect, it } from 'vitest';
import { decideStartup } from './startupGate';

const connected = async () => ({ status: 'connected' as const, balance: 1 });
const rejected = async () => ({ status: 'rejected' as const });
const unreachable = async () => ({ status: 'unreachable' as const });
const codex = { id: 'codex-cli', name: 'Codex' };

describe('decideStartup', () => {
  it('no brain at all: Setup, no reason', async () => {
    expect(await decideStartup({ verifyKey: connected })).toEqual({ open: 'setup' });
  });
  it('a selected CLI brain that is installed and signed in: Hub', async () => {
    expect(await decideStartup({ vendor: codex, cli: { installed: true, signedIn: true }, verifyKey: connected })).toEqual({ open: 'hub' });
  });
  it('a selected CLI brain that is gone: Setup with the reason', async () => {
    const r = await decideStartup({ vendor: codex, cli: { installed: false, signedIn: false }, backboardKey: 'bb', verifyKey: connected });
    expect(r).toMatchObject({ open: 'setup', reason: expect.stringMatching(/Codex is not installed/) });
  });
  it('a selected CLI brain that is signed out: Setup with the reason', async () => {
    const r = await decideStartup({ vendor: codex, cli: { installed: true, signedIn: false }, verifyKey: connected });
    expect(r).toMatchObject({ open: 'setup', reason: expect.stringMatching(/Codex is not signed in/) });
  });
  it('a saved Backboard key that Backboard rejects: Setup with the reason (the Hack Dearborn leftover case)', async () => {
    const r = await decideStartup({ backboardKey: 'old-key', verifyKey: rejected });
    expect(r).toMatchObject({ open: 'setup', reason: expect.stringMatching(/no longer accepted/) });
  });
  it('a saved key that still works: Hub', async () => {
    expect(await decideStartup({ backboardKey: 'key', verifyKey: connected })).toEqual({ open: 'hub' });
  });
  it('Backboard unreachable (offline): Hub, never a lock-out', async () => {
    expect(await decideStartup({ backboardKey: 'key', verifyKey: unreachable })).toEqual({ open: 'hub' });
  });
});
