import { createHash, randomBytes } from 'node:crypto';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
] as const;

export interface PkceChallenge { verifier: string; challenge: string; state: string }

export function createPkceChallenge(): PkceChallenge {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(16).toString('base64url'),
  };
}

export function authorizationUrl(input: {
  clientId: string; redirectUri: string; challenge: string; state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: (input.scopes ?? GOOGLE_SCOPES).join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    state: input.state,
  }).toString();
  return url.toString();
}

export function missingScopes(granted: string | readonly string[], required: readonly string[] = GOOGLE_SCOPES): string[] {
  const have = new Set(typeof granted === 'string' ? granted.split(/\s+/).filter(Boolean) : granted);
  return required.filter(scope => !have.has(scope));
}
