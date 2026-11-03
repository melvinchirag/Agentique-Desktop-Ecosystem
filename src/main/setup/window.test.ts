import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSetup } from './window';
import { SETUP_IPC } from './contracts';
import { detectClaudeCli, detectCodexCli, installCodexCli, signInCodexCli } from '../brain/detect';
import { writeSetupEnv } from './envFile';

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  env: {} as Record<string, string>,
  contents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), send: vi.fn() },
}));
vi.mock('electron', () => ({
  app: { getPath: () => 'ADE.exe' }, shell: {},
  ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => state.handlers.set(name, fn), on: vi.fn() },
  BrowserWindow: class {
    webContents = state.contents;
    isDestroyed() { return false; }
    on() {} loadFile() {} show() {} focus() {}
  },
}));
vi.mock('../core/realCore', () => ({
  loadRealCoreEnv: () => ({ env: state.env }),
  brainKind: (env: Record<string, string>) => env.ADE_BRAIN ?? null,
}));
vi.mock('../store/tiger', () => ({ adeDataDir: () => 'test-data' }));
vi.mock('../account/flags', () => ({ accountEnabled: () => false }));
vi.mock('./envFile', () => ({ writeSetupEnv: vi.fn() }));
vi.mock('../brain/detect', () => ({ detectClaudeCli: vi.fn(), detectCodexCli: vi.fn(),
  installClaudeCli: vi.fn(), installCodexCli: vi.fn(), signInClaudeCli: vi.fn(), signInCodexCli: vi.fn() }));

const event = { sender: state.contents };
const invoke = (name: string, which?: unknown, caller = event) => state.handlers.get(name)!(caller, which);
beforeEach(() => {
  vi.clearAllMocks(); state.env = {}; state.handlers.clear();
  vi.mocked(detectClaudeCli).mockResolvedValue({ installed: true, signedIn: true, version: 'claude-version' });
  vi.mocked(detectCodexCli).mockResolvedValue({ installed: true, signedIn: true, path: 'native-codex.exe', version: '0.164.0' });
  registerSetup({ preload: '', rendererDir: '', envPaths: [], account: {} as any })();
});

describe('Setup CLI choice IPC', () => {
  it('defaults to Claude and reports active only for the selected brain', async () => {
    state.env = { ADE_BRAIN: 'codex-cli' };
    expect(await invoke(SETUP_IPC.brainStatus)).toMatchObject({ version: 'claude-version', active: false });
    expect(await invoke(SETUP_IPC.brainStatus, 'codex')).toMatchObject({ version: '0.164.0', active: true });
    state.env = { ADE_BRAIN: 'claude-cli' };
    expect(await invoke(SETUP_IPC.brainStatus)).toMatchObject({ active: true });
  });

  it('persists the selected Codex native path and preserves the default Claude choice', async () => {
    expect(await invoke(SETUP_IPC.brainUse, 'codex')).toEqual({ ok: true });
    expect(writeSetupEnv).toHaveBeenLastCalledWith(expect.any(String), { ADE_BRAIN: 'codex-cli', ADE_CODEX_BIN: 'native-codex.exe' }, []);
    expect(await invoke(SETUP_IPC.brainUse)).toEqual({ ok: true });
    expect(writeSetupEnv).toHaveBeenLastCalledWith(expect.any(String), { ADE_BRAIN: 'claude-cli' }, ['ADE_CLAUDE_BIN']);
  });

  it('rejects invalid choices and foreign senders before discovery, installation or persistence', async () => {
    for (const name of [SETUP_IPC.brainStatus, SETUP_IPC.brainInstall, SETUP_IPC.brainSignIn, SETUP_IPC.brainUse]) {
      for (const which of ['gemini', '', null, {}, 1]) await invoke(name, which);
      await invoke(name, 'codex', { sender: {} as typeof state.contents });
    }
    expect(detectCodexCli).not.toHaveBeenCalled();
    expect(detectClaudeCli).not.toHaveBeenCalled();
    expect(installCodexCli).not.toHaveBeenCalled();
    expect(writeSetupEnv).not.toHaveBeenCalled();
  });

  it('routes Codex install and login, and requires installed authenticated Codex before use', async () => {
    vi.mocked(installCodexCli).mockResolvedValue(true);
    vi.mocked(signInCodexCli).mockReturnValue(true);
    expect(await invoke(SETUP_IPC.brainInstall, 'codex')).toEqual({ ok: true });
    expect(await invoke(SETUP_IPC.brainSignIn, 'codex')).toEqual({ ok: true });
    expect(signInCodexCli).toHaveBeenCalledWith('native-codex.exe');
    for (const installed of [false, true]) {
      vi.mocked(detectCodexCli).mockResolvedValue({ installed, signedIn: false });
      expect(await invoke(SETUP_IPC.brainUse, 'codex')).toEqual({ ok: false, error: installed ? 'Codex is not signed in yet' : 'Codex is not installed yet' });
    }
    expect(writeSetupEnv).not.toHaveBeenCalled();
  });
});
