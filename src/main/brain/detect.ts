/**
 * Find, install and sign in the Claude Code CLI for the first-run Setup screen. No shell is ever used:
 * each step spawns one known executable with an argument list.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BrainStatus {
  installed: boolean;
  /** Where the executable was found; set ADE_CLAUDE_BIN to this when it is not on PATH. */
  path?: string;
  version?: string;
  signedIn: boolean;
  email?: string;
}

/** Where the official installer puts claude.exe on Windows; it may not be on the PATH of an already-running process. */
export const defaultClaudePath = () => process.platform === 'win32' ? join(homedir(), '.local', 'bin', 'claude.exe') : join(homedir(), '.local', 'bin', 'claude');

function run(bin: string, args: string[], timeoutMs = 20_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try { child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { resolve({ ok: false, out: '' }); return; }
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, out }); }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, out: '' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out }); });
  });
}

export async function detectClaudeCli(preferred?: string): Promise<BrainStatus> {
  const candidates = [preferred, 'claude', defaultClaudePath()].filter((c): c is string => !!c);
  for (const bin of candidates) {
    if (bin !== 'claude' && !existsSync(bin)) continue;
    const version = await run(bin, ['--version']);
    if (!version.ok) continue;
    const status = await run(bin, ['auth', 'status', '--json']);
    let signedIn = false, email: string | undefined;
    try {
      const j = JSON.parse(status.out.trim().split(/\r?\n/).filter((l) => l.trim()).join('\n')) as { loggedIn?: unknown; email?: unknown };
      signedIn = j.loggedIn === true; if (typeof j.email === 'string') email = j.email;
    } catch { signedIn = /"loggedIn":\s*true/.test(status.out); }
    return { installed: true, path: bin === 'claude' ? undefined : bin, version: version.out.trim().split(/\s/)[0], signedIn, ...(email ? { email } : {}) };
  }
  return { installed: false, signedIn: false };
}

/** The official installer (Windows: PowerShell; others: the shell script). Streams its output as progress lines. */
export function installClaudeCli(progress: (line: string) => void): Promise<boolean> {
  const [bin, args] = process.platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex']]
    : ['bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash']];
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (d: Buffer) => { for (const line of d.toString().split(/\r?\n/)) if (line.trim()) progress(line.trim().slice(0, 200)); };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('error', (e) => { progress(`Installer could not start: ${e.message}`); resolve(false); });
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Opens Claude Code's own sign-in in its own console window (it opens the browser). Returns at once; poll detectClaudeCli() afterwards. */
export function signInClaudeCli(bin: string): boolean {
  try {
    const child = spawn(bin, ['auth', 'login'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}
