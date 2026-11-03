import type { Verification } from './setup/setupService';

export interface StartupInput {
  /** The CLI brain named by ADE_BRAIN, if any. */
  vendor?: { id: string; name: string };
  /** What detectCli found for that vendor. */
  cli?: { installed: boolean; signedIn: boolean };
  backboardKey?: string;
  verifyKey: (key: string) => Promise<Verification>;
}

export type StartupDecision = { open: 'hub' } | { open: 'setup'; reason?: string };

/**
 * Decides whether ADE opens the Hub or Setup, and says why. A selected CLI brain must be installed and signed in;
 * a saved Backboard key must still be accepted. Backboard being unreachable (offline) does not lock the user out:
 * Chip reports that per request.
 */
export async function decideStartup(input: StartupInput): Promise<StartupDecision> {
  if (input.vendor) {
    const { name } = input.vendor;
    if (!input.cli?.installed) return { open: 'setup', reason: `ADE is set to think with ${name}, but ${name} is not installed on this computer any more. Install it below, or pick another AI.` };
    if (!input.cli.signedIn) return { open: 'setup', reason: `ADE is set to think with ${name}, but ${name} is not signed in. Sign in below, then continue.` };
    return { open: 'hub' };
  }
  const key = input.backboardKey?.trim();
  if (!key) return { open: 'setup' };
  const verification = await input.verifyKey(key);
  if (verification.status === 'rejected') {
    return { open: 'setup', reason: 'The saved Backboard key is no longer accepted (Backboard answered 401). Paste a new key below, or pick the AI you already have.' };
  }
  return { open: 'hub' };
}
