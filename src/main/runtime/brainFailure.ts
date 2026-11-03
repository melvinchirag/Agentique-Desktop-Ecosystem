/**
 * Turns a brain failure (Backboard HTTP error, or a CLI brain's exit text) into one plain sentence Chip can say,
 * with the thing the user can do about it. Unknown causes keep the old foggy line; the raw message goes to the log file.
 */
export const FOGGY_LINE = "My brain's a bit foggy. Say that again?";

export type BrainFailureKind =
  | 'backboard_rejected' | 'backboard_credit' | 'rate_limited'
  | 'cli_not_signed_in' | 'cli_missing' | 'cli_too_old' | 'timeout' | 'network' | 'unknown';

export interface BrainFailureExplanation { kind: BrainFailureKind; bubble: string; speech: string }

const CLI_PREFIX = /^(Claude Code|Codex|Gemini CLI):\s*/;

export function explainBrainFailure(message: string): BrainFailureExplanation {
  const text = message || '';
  const vendor = CLI_PREFIX.exec(text)?.[1] ?? (/backboard/i.test(text) ? 'Backboard' : 'my AI');
  const body = text.replace(CLI_PREFIX, '');
  const http = /returned (\d{3})\b/.exec(text)?.[1];

  if (http === '401' || http === '403' || /invalid api key|api key (is )?invalid|key was not accepted/i.test(body)) {
    return { kind: 'backboard_rejected', bubble: 'Key refused',
      speech: 'Backboard will not accept the saved key any more. Open ADE Setup and paste a new key, or pick the AI you already have.' };
  }
  if (http === '402' || /insufficient (credit|funds|balance)|out of credit|payment required/i.test(body)) {
    return { kind: 'backboard_credit', bubble: 'Out of credit',
      speech: 'Backboard says the account is out of credit. Top it up, or switch to the AI you already have in ADE Setup.' };
  }
  if (http === '429' || /rate limit|too many requests/i.test(body)) {
    return { kind: 'rate_limited', bubble: 'Slow down', speech: 'I am being rate limited. Give me a minute and ask again.' };
  }
  if (vendor !== 'Backboard' && vendor !== 'my AI') {
    if (/not (logged|signed) in|login required|authentication required|please (log|sign) in|unauthorized|auth(entication)? (error|failed)/i.test(body)) {
      return { kind: 'cli_not_signed_in', bubble: 'Sign in', speech: `${vendor} says you are not signed in. Open ADE Setup, sign in, then ask me again.` };
    }
    if (/ENOENT|not recognized as an internal|no such file|cannot find the (file|path)|command not found/i.test(body)) {
      return { kind: 'cli_missing', bubble: "Can't find it", speech: `I can't find ${vendor} on this computer. Open ADE Setup to install it, or choose another AI.` };
    }
    if (/unexpected argument|unrecognized (option|argument|subcommand)|unknown (option|flag|argument|command)|invalid (option|flag)|found argument|is not a valid|no such option|usage:/i.test(body)) {
      return { kind: 'cli_too_old', bubble: 'Update needed', speech: `Your ${vendor} is older than I need. Update ${vendor}, then ask me again.` };
    }
  }
  if (/abort|timed out|timeout|did not answer in time/i.test(body)) {
    return { kind: 'timeout', bubble: 'Too slow', speech: `${vendor === 'my AI' ? 'My AI' : vendor} did not answer in time. Try again; if it keeps happening, check ADE Setup.` };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|ETIMEDOUT/i.test(body)) {
    return { kind: 'network', bubble: 'Offline?', speech: 'I cannot reach the internet right now. Check the connection and ask again.' };
  }
  return { kind: 'unknown', bubble: 'Foggy 😵', speech: FOGGY_LINE };
}
