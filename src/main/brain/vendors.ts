/**
 * The three CLI brains ADE can use: the AI the user already pays for, driven through its own command-line
 * tool. One contract, three adapters. Every call is a fresh headless process with the prompt on stdin; no
 * shell is ever used. ADE_BRAIN selects one (claude-cli | codex-cli | gemini-cli).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type BrainVendorId = 'claude-cli' | 'codex-cli' | 'gemini-cli';
export const BRAIN_VENDOR_IDS: BrainVendorId[] = ['claude-cli', 'codex-cli', 'gemini-cli'];

/** Strict enough for OpenAI structured output, accepted by Claude Code's --json-schema too. */
export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      description: 'Actions for the application to perform now. Empty when you answer instead.',
      items: { type: 'object', properties: { action: { type: 'string' }, input: { type: 'string', description: 'The input for that action as a JSON object, encoded as a string.' } }, required: ['action', 'input'], additionalProperties: false },
    },
    content: { type: 'string', description: 'Your answer when no action is needed, in the format the instructions ask for. Empty when you request actions.' },
  },
  required: ['actions', 'content'],
  additionalProperties: false,
};

export interface InvokeContext {
  /** The animal's instructions plus ADE's action rules. */
  system: string;
  /** The rendered conversation (actions list, transcript, closing instruction). */
  prompt: string;
  /** Expect the decision JSON (actions or content) rather than free text. */
  structured: boolean;
  webSearch: boolean;
  /** model_name when the user's chosen provider matches this vendor; otherwise the vendor default. */
  model?: string;
  /** A neutral folder the vendor may use for its own files; never the user's project. */
  workDir: string;
  /** Path of a file holding DECISION_SCHEMA, for vendors that take the schema as a file. */
  schemaFile: string;
  /** Path the vendor may write its final message to. */
  resultFile: string;
}

export interface ParsedResult { is_error: boolean; text: string; structured?: unknown; model?: string }

export interface BrainVendor {
  id: BrainVendorId;
  /** Shown to the user. */
  name: string;
  /** Who the plan is with. */
  company: string;
  bin: string;
  /** Where the official installer puts it; may not be on the PATH of a running process. */
  defaultPath(): string;
  /** Which Settings provider id maps to this vendor's --model flag. */
  provider: 'anthropic' | 'openai' | 'google';
  /** Process arguments; the stdin text is returned too. */
  invoke(ctx: InvokeContext): { args: string[]; stdin: string };
  /** Reads the process output (and the result file when the vendor writes one). */
  parse(stdout: string, exitCode: number | null, resultFile?: string): ParsedResult;
  versionArgs: string[];
  /** Headless status check; undefined when the vendor has none (a tiny prompt is used instead). */
  authStatusArgs?: string[];
  parseAuthStatus?(out: string, exitCode: number | null): { signedIn: boolean; email?: string };
  /** Opens the vendor's own sign-in (browser). Runs in its own console window. */
  loginArgs: string[];
  /** Official installer: Windows and POSIX forms, executable plus argument list. */
  installer: { win32: [string, string[]]; posix: [string, string[]] };
  /** Honest note for the Setup screen. */
  note?: string;
}

const lastJsonLine = (raw: string): Record<string, unknown> | undefined => {
  const line = raw.trim().split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  if (!line) return undefined;
  try { return JSON.parse(line) as Record<string, unknown>; } catch { return undefined; }
};

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');

export const CLAUDE: BrainVendor = {
  id: 'claude-cli', name: 'Claude Code', company: 'Anthropic', bin: 'claude', provider: 'anthropic',
  defaultPath: () => join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
  invoke: (c) => {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--exclude-dynamic-system-prompt-sections', '--strict-mcp-config',
      '--tools', c.webSearch ? 'WebSearch,WebFetch' : '', '--system-prompt', c.system];
    if (c.structured) args.push('--json-schema', JSON.stringify(DECISION_SCHEMA));
    if (c.model) args.push('--model', c.model);
    return { args, stdin: c.prompt };
  },
  parse: (stdout) => {
    const j = lastJsonLine(stdout);
    if (!j) return { is_error: true, text: stdout.trim().slice(0, 300) || 'no output' };
    const usage = j.modelUsage && typeof j.modelUsage === 'object' ? Object.keys(j.modelUsage as object) : [];
    return { is_error: !!j.is_error, text: typeof j.result === 'string' ? j.result : '', structured: j.structured_output, ...(usage[0] ? { model: usage[0] } : {}) };
  },
  versionArgs: ['--version'],
  authStatusArgs: ['auth', 'status', '--json'],
  parseAuthStatus: (out) => {
    try { const j = JSON.parse(out.trim().split(/\r?\n/).filter((l) => l.trim()).join('\n')) as { loggedIn?: unknown; email?: unknown }; return { signedIn: j.loggedIn === true, ...(typeof j.email === 'string' ? { email: j.email } : {}) }; }
    catch { return { signedIn: /"loggedIn":\s*true/.test(out) }; }
  },
  loginArgs: ['auth', 'login'],
  installer: { win32: ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex']], posix: ['bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash']] },
};

export const CODEX: BrainVendor = {
  id: 'codex-cli', name: 'Codex', company: 'OpenAI', bin: 'codex', provider: 'openai',
  defaultPath: () => process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe') : '/usr/local/bin/codex',
  invoke: (c) => {
    // codex exec has no system-prompt flag: the instructions lead the stdin text. Read-only sandbox, nothing persisted.
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-s', 'read-only', '-C', c.workDir, '-o', c.resultFile];
    if (c.structured) args.push('--output-schema', c.schemaFile);
    if (c.model) args.push('-m', c.model);
    args.push('-');
    return { args, stdin: `${c.system}\n\n${c.prompt}` };
  },
  parse: (stdout, exitCode, resultFile) => {
    let text = '';
    try { if (resultFile) text = readFileSync(resultFile, 'utf8').trim(); } catch { /* no result file */ }
    if (!text) {
      // Fallback: the final message is printed to stdout under a "codex" line, before "tokens used".
      const j = lastJsonLine(stdout);
      if (j) text = JSON.stringify(j);
      else { const m = /\ncodex\r?\n([\s\S]*?)(?:\r?\ntokens used|$)/.exec(`\n${stdout}`); if (m) text = m[1]!.trim(); }
    }
    if (!text && exitCode !== 0) return { is_error: true, text: stdout.trim().slice(0, 300) || `codex exited ${exitCode}` };
    if (!text) return { is_error: true, text: 'codex wrote no final message' };
    let structured: unknown; try { structured = JSON.parse(stripFences(text)); } catch { /* free text */ }
    return { is_error: false, text, ...(structured !== undefined ? { structured } : {}) };
  },
  versionArgs: ['--version'],
  authStatusArgs: ['login', 'status'],
  parseAuthStatus: (out, exitCode) => ({ signedIn: exitCode === 0 && /logged in/i.test(out) && !/not logged in/i.test(out) }),
  loginArgs: ['login'],
  installer: { win32: ['npm.cmd', ['install', '-g', '@openai/codex']], posix: ['npm', ['install', '-g', '@openai/codex']] },
  note: 'Tested on this machine with codex-cli 0.166.',
};

export const GEMINI: BrainVendor = {
  id: 'gemini-cli', name: 'Gemini CLI', company: 'Google', bin: 'gemini', provider: 'google',
  defaultPath: () => process.platform === 'win32' ? join(homedir(), 'AppData', 'Roaming', 'npm', 'gemini.cmd') : '/usr/local/bin/gemini',
  invoke: (c) => {
    // Documented interface: -p for a headless prompt, --output-format json → { response, stats }. No schema flag, so the JSON is asked for in the prompt.
    const args = ['-p', '-', '--output-format', 'json'];
    if (c.model) args.push('-m', c.model);
    const ask = c.structured ? '\n\nReply with the JSON object only (keys "actions" and "content"), no prose, no code fences.' : '';
    return { args, stdin: `${c.system}\n\n${c.prompt}${ask}` };
  },
  parse: (stdout, exitCode) => {
    const j = lastJsonLine(stdout);
    const text = j && typeof j.response === 'string' ? j.response : stdout.trim();
    if (exitCode !== 0 && !text) return { is_error: true, text: 'gemini failed' };
    if (/not (logged|signed) in|authentication required|login required/i.test(text) && text.length < 400) return { is_error: true, text };
    let structured: unknown; try { structured = JSON.parse(stripFences(text)); } catch { /* free text */ }
    return { is_error: false, text, ...(structured !== undefined ? { structured } : {}) };
  },
  versionArgs: ['--version'],
  loginArgs: [],
  installer: { win32: ['npm.cmd', ['install', '-g', '@google/gemini-cli']], posix: ['npm', ['install', '-g', '@google/gemini-cli']] },
  note: 'Built on the documented interface; not yet tested on a machine with Gemini CLI installed.',
};

export const VENDORS: Record<BrainVendorId, BrainVendor> = { 'claude-cli': CLAUDE, 'codex-cli': CODEX, 'gemini-cli': GEMINI };

/** The vendor named by ADE_BRAIN, or undefined for Backboard. */
export const vendorFromEnv = (env: Record<string, string | undefined>): BrainVendor | undefined => {
  const id = env.ADE_BRAIN?.trim().toLowerCase();
  return id && id in VENDORS ? VENDORS[id as BrainVendorId] : undefined;
};
