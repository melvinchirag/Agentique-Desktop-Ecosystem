import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { delimiter, join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { detectCodexCli, installCodexCli, resolveCodexBin, signInCodexCli } from '../src/main/brain/detect';

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const arch = Object.getOwnPropertyDescriptor(process, 'arch')!;
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  Object.defineProperty(process, 'arch', arch);
  vi.unstubAllEnvs(); vi.resetAllMocks();
});
function windows() { Object.defineProperty(process, 'platform', { value: 'win32' }); Object.defineProperty(process, 'arch', { value: 'x64' }); }
function child(out: string, code = 0) {
  const c = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), unref: vi.fn() });
  queueMicrotask(() => { c.stdout.emit('data', Buffer.from(out)); c.emit('close', code); });
  return c as unknown as ReturnType<typeof spawn>;
}

describe('Codex discovery and Setup commands', () => {
  it('resolves native binaries in PATH, nested and flat npm packages, AppData and arm64 without using shims', () => {
    windows();
    vi.stubEnv('PATH', ['global', 'other'].join(delimiter)); vi.stubEnv('APPDATA', 'roaming');
    const bins = [
      join('global', 'codex.exe'),
      join('global', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
      join('global', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
      join('roaming', 'npm', 'node_modules', '@openai', 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'),
    ];
    for (const bin of bins) {
      vi.mocked(existsSync).mockImplementation(path => path === bin);
      expect(resolveCodexBin()).toBe(bin);
      expect(resolveCodexBin(join('global', 'codex.cmd'))).toBe(bin);
    }
    vi.mocked(existsSync).mockImplementation(path => path === 'preferred.exe');
    expect(resolveCodexBin('preferred.exe')).toBe('preferred.exe');
    vi.mocked(existsSync).mockReturnValue(false);
    expect(resolveCodexBin()).toBe('codex.exe');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(resolveCodexBin()).toBe('codex');
    expect(resolveCodexBin('/custom/codex')).toBe('/custom/codex');
  });

  it('reports version and authenticated status without an email or auth payload', async () => {
    windows(); vi.mocked(existsSync).mockReturnValue(false);
    for (const [out, code, signedIn] of [['Logged in using ChatGPT', 0, true], ['Logged in using ChatGPT', 1, false], ['Not logged in', 0, false]] as const) {
      vi.mocked(spawn).mockImplementationOnce(() => child('codex-cli 0.164.0')).mockImplementationOnce(() => child(out, code));
      expect(await detectCodexCli()).toEqual({ installed: true, path: 'codex.exe', version: '0.164.0', signedIn });
    }
    expect(vi.mocked(spawn).mock.calls[0]!.slice(0, 2)).toEqual(['codex.exe', ['--version']]);
    expect(vi.mocked(spawn).mock.calls[1]!.slice(0, 2)).toEqual(['codex.exe', ['login', 'status']]);
    vi.mocked(spawn).mockImplementationOnce(() => child('', 1));
    expect(await detectCodexCli()).toEqual({ installed: false, signedIn: false });
  });

  it('streams the npm installer and launches detached browser login on the native executable', async () => {
    windows(); vi.mocked(existsSync).mockImplementation(path => path === 'custom.exe');
    vi.mocked(spawn).mockImplementation(() => child('installed\n'));
    const progress = vi.fn();
    expect(await installCodexCli(progress)).toBe(true);
    expect(progress).toHaveBeenCalledWith('installed');
    expect(vi.mocked(spawn).mock.calls[0]!.slice(0, 2)).toEqual(['powershell.exe', ['-NoProfile', '-Command', 'npm install -g @openai/codex']]);
    expect(signInCodexCli('custom.exe')).toBe(true);
    expect(vi.mocked(spawn).mock.calls[1]).toEqual(['custom.exe', ['login'], { detached: true, stdio: 'ignore', windowsHide: false }]);
    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(await installCodexCli(progress)).toBe(true);
    expect(vi.mocked(spawn).mock.calls[2]!.slice(0, 2)).toEqual(['bash', ['-c', 'npm install -g @openai/codex']]);
  });
});
