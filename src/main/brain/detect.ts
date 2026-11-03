/**
 * Find, install and sign in a CLI brain for the Setup screen. No shell is ever used: each step spawns one
 * known executable with an argument list.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CLAUDE, VENDORS, type BrainVendor, type BrainVendorId } from './vendors';

export interface BrainStatus {
  installed: boolean;
  /** Where the executable was found; set ADE_<VENDOR>_BIN to this when it is not on PATH. */
  path?: string;
  version?: string;
  signedIn: boolean;
  email?: string;
}

/** ADE_CLAUDE_BIN / ADE_CODEX_BIN / ADE_GEMINI_BIN */
export const binEnvKey = (vendor: BrainVendor) => `ADE_${vendor.bin.toUpperCase()}_BIN`;

function run(bin: string, args: string[], stdin = '', timeoutMs = 20_000): Promise<{ ok: boolean; code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try { child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { resolve({ ok: false, code: null, out: '' }); return; }
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, code: null, out }); }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, code: null, out: '' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, out }); });
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin);
  });
}

export async function detectCli(vendor: BrainVendor, preferred?: string): Promise<BrainStatus> {
  const candidates = [preferred, vendor.bin, vendor.defaultPath(), ...(vendor.extraPaths?.() ?? [])].filter((c): c is string => !!c);
  for (const bin of candidates) {
    if (bin !== vendor.bin && !existsSync(bin)) continue;
    const version = await run(bin, vendor.versionArgs);
    if (!version.ok) continue;
    let signedIn = false, email: string | undefined;
    if (vendor.authStatusArgs && vendor.parseAuthStatus) {
      const status = await run(bin, vendor.authStatusArgs);
      ({ signedIn, email } = vendor.parseAuthStatus(status.out, status.code));
    } else {
      // No status command: a one-word prompt tells us whether the tool can answer.
      const call = vendor.invoke({ system: 'Reply with the single word ok.', prompt: 'ok', structured: false, webSearch: false, workDir: process.cwd(), schemaFile: '', resultFile: '' });
      const probe = await run(bin, call.args, call.stdin, 60_000);
      signedIn = probe.ok && !vendor.parse(probe.out, probe.code).is_error;
    }
    const version_ = version.out.trim().split(/\s+/).find((w) => /\d/.test(w)) ?? version.out.trim().slice(0, 20);
    return { installed: true, path: bin === vendor.bin ? undefined : bin, version: version_, signedIn, ...(email ? { email } : {}) };
  }
  return { installed: false, signedIn: false };
}

/** Kept for the first cut's callers. */
export const detectClaudeCli = (preferred?: string) => detectCli(CLAUDE, preferred);

/** The vendor's official installer. Streams its output as progress lines. */
export function installCli(vendor: BrainVendor, progress: (line: string) => void): Promise<boolean> {
  const [bin, args] = process.platform === 'win32' ? vendor.installer.win32 : vendor.installer.posix;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { progress(`Installer could not start: ${(e as Error).message}`); resolve(false); return; }
    const feed = (d: Buffer) => { for (const line of d.toString().split(/\r?\n/)) if (line.trim()) progress(line.trim().slice(0, 200)); };
    child.stdout?.on('data', feed); child.stderr?.on('data', feed);
    child.on('error', (e) => { progress(`Installer could not start: ${e.message}`); resolve(false); });
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Opens the vendor's own sign-in in its own console window (it opens the browser). Returns at once; poll detectCli() afterwards. */
export function signInCli(vendor: BrainVendor, bin: string): boolean {
  try {
    const child = spawn(bin, vendor.loginArgs, { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

export const vendorById = (id: string): BrainVendor | undefined => (id in VENDORS ? VENDORS[id as BrainVendorId] : undefined);
