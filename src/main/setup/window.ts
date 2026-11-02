import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { adeDataDir } from '../paths';
import { loadRealCoreEnv, usesCliBrain } from '../core/realCore';
import { readEnvFile } from '../sponsors/env';
import { detectClaudeCli, installClaudeCli, signInClaudeCli } from '../brain/detect';
import { SETUP_IPC } from './contracts';
import { writeSetupEnv } from './envFile';
import { completeSetup, verifyBackboardKey } from './setupService';
import type { AccountStore } from '../account/store';
import type { SupabaseAccountClient } from '../account/supabase';
import { ACCOUNT_ERRORS } from '../account/supabase';
import type { AccountHeartbeat } from '../account/heartbeat';
import { accountEnabled } from '../account/flags';

const mask = (value?: string) => value ? `${value.slice(0, 4)}••••` : null;

export function registerSetup(opts: { preload: string; rendererDir: string; devUrl?: string; envPaths: string[];
  account: { store: AccountStore; client: SupabaseAccountClient; heartbeat: AccountHeartbeat } }): () => void {
  let window: BrowserWindow | undefined;
  let saving = false;
  const file = join(adeDataDir(), '.env');
  const own = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => window && !window.isDestroyed() && event.sender === window.webContents;
  const signedIn = async () => !accountEnabled() || !!await opts.account.store.load().catch(() => null);
  const open = () => {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
    window = new BrowserWindow({ width: 520, height: 590, minWidth: 480, minHeight: 540,
      title: 'ADE Setup', backgroundColor: '#141923', autoHideMenuBar: true,
      webPreferences: { preload: opts.preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url === 'https://app.backboard.io/' || url.startsWith('https://app.backboard.io/')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('closed', () => { window = undefined; });
    void (opts.devUrl ? window.loadURL(`${opts.devUrl}/setup.html`) : window.loadFile(join(opts.rendererDir, 'setup.html')));
  };
  ipcMain.handle(SETUP_IPC.status, () => {
    const env = loadRealCoreEnv({ exePath: app.getPath('exe'), envPaths: opts.envPaths }).env;
    return { backboard: mask(env.BACKBOARD_API_KEY), elevenLabs: mask(env.ELEVENLABS_API_KEY) };
  });
  // "Use the AI you already have": Claude Code on this machine.
  let brainPath: string | undefined;
  const currentEnv = () => loadRealCoreEnv({ exePath: app.getPath('exe'), envPaths: opts.envPaths }).env;
  ipcMain.handle(SETUP_IPC.brainStatus, async () => {
    const env = currentEnv();
    const found = await detectClaudeCli(env.ADE_CLAUDE_BIN);
    brainPath = found.path;
    return { installed: found.installed, version: found.version, signedIn: found.signedIn, email: found.email, active: usesCliBrain(env) };
  });
  ipcMain.handle(SETUP_IPC.brainInstall, async (event) => {
    if (!own(event)) return { ok: false };
    const ok = await installClaudeCli(message => { if (window && !window.isDestroyed()) window.webContents.send(SETUP_IPC.progress, message); });
    return { ok };
  });
  ipcMain.handle(SETUP_IPC.brainSignIn, async (event) => {
    if (!own(event)) return { ok: false };
    const found = await detectClaudeCli(currentEnv().ADE_CLAUDE_BIN);
    if (!found.installed) return { ok: false };
    return { ok: signInClaudeCli(found.path ?? 'claude') };
  });
  ipcMain.handle(SETUP_IPC.brainUse, async (event) => {
    if (!own(event)) return { ok: false, error: 'Not allowed' };
    if (!await signedIn()) return { ok: false, error: 'Sign in to ADE first' };
    const found = await detectClaudeCli(currentEnv().ADE_CLAUDE_BIN);
    if (!found.installed) return { ok: false, error: 'Claude Code is not installed yet' };
    if (!found.signedIn) return { ok: false, error: 'Claude Code is not signed in yet' };
    writeSetupEnv(file, { ADE_BRAIN: 'claude-cli', ...(found.path ? { ADE_CLAUDE_BIN: found.path } : {}) }, found.path ? [] : ['ADE_CLAUDE_BIN']);
    brainPath = found.path;
    return { ok: true };
  });
  ipcMain.handle(SETUP_IPC.accountStatus, async () => {
    if (!accountEnabled()) return { enabled: false, signedIn: false };
    const account = await opts.account.store.load().catch(() => null);
    return account ? { enabled: true, signedIn: true, email: account.email } : { enabled: true, signedIn: false };
  });
  ipcMain.handle(SETUP_IPC.sendCode, async (event, email: unknown) => {
    if (!own(event) || !accountEnabled() || typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254) {
      return { ok: false, error: 'Enter a valid email address' };
    }
    try { await opts.account.client.sendCode(email.trim()); return { ok: true }; }
    catch (error) { return { ok: false, error: error instanceof Error && Object.values(ACCOUNT_ERRORS).includes(error.message as typeof ACCOUNT_ERRORS[keyof typeof ACCOUNT_ERRORS])
      ? error.message : ACCOUNT_ERRORS.network }; }
  });
  ipcMain.handle(SETUP_IPC.verifyCode, async (event, email: unknown, code: unknown) => {
    if (!own(event) || !accountEnabled() || typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return { ok: false, error: ACCOUNT_ERRORS.code };
    }
    try {
      const session = await opts.account.client.verifyCode(email.trim(), code);
      await opts.account.store.save({ ...session, email: email.trim(), deviceId: await opts.account.store.deviceId() });
      opts.account.heartbeat.start();
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error && Object.values(ACCOUNT_ERRORS).includes(error.message as typeof ACCOUNT_ERRORS[keyof typeof ACCOUNT_ERRORS])
      ? error.message : ACCOUNT_ERRORS.network }; }
  });
  ipcMain.handle(SETUP_IPC.signOut, async () => {
    await opts.account.heartbeat.stop();
    await opts.account.store.clear();
  });
  ipcMain.handle(SETUP_IPC.verify, async (event, key: unknown) => {
    if (!own(event) || typeof key !== 'string' || !key.trim() || key.length > 4096) throw new Error('Enter a Backboard key');
    if (!await signedIn()) throw new Error('Sign in to ADE first');
    return verifyBackboardKey(key.trim());
  });
  ipcMain.handle(SETUP_IPC.save, async (event, key: unknown, voice: unknown) => {
    if (!own(event) || typeof key !== 'string' || !key.trim() || key.length > 4096 ||
      (voice !== undefined && (typeof voice !== 'string' || voice.length > 4096))) return { ok: false, error: 'Enter a valid key' };
    if (!await signedIn()) return { ok: false, error: 'Sign in to ADE first' };
    if (saving) return { ok: false, error: 'Setup is already running' };
    const higherPriority = [process.env.BACKBOARD_API_KEY, ...opts.envPaths.map(path => readEnvFile(path).BACKBOARD_API_KEY)]
      .find(value => value?.trim());
    if (higherPriority && higherPriority !== key.trim()) return {
      ok: false, error: 'A Backboard key in the process or app folder takes priority. Remove it there before changing keys.',
    };
    saving = true;
    try {
      const userEnvKey = readEnvFile(file).BACKBOARD_API_KEY;
      const existingEnv = !userEnvKey || userEnvKey === key.trim()
        ? loadRealCoreEnv({ exePath: app.getPath('exe'), envPaths: opts.envPaths }).env : {};
      await completeSetup(file, key.trim(), typeof voice === 'string' ? voice.trim() : undefined,
        message => { if (window && !window.isDestroyed()) window.webContents.send(SETUP_IPC.progress, message); }, existingEnv);
      return { ok: true };
    } catch (error) {
      // Backboard errors can include response bodies. Never forward an exception or credential to the renderer.
      return { ok: false, error: error instanceof Error && ['That key was not accepted', 'Could not reach Backboard'].includes(error.message)
        ? error.message : 'Could not finish creating assistants. Try Save again.' };
    } finally { saving = false; }
  });
  ipcMain.on(SETUP_IPC.restart, event => { if (own(event)) {
    app.relaunch({ args: process.argv.slice(1).filter(arg => arg !== '--demo') }); app.exit(0);
  } });
  ipcMain.on(SETUP_IPC.demo, event => { if (own(event)) {
    app.relaunch({ args: [...process.argv.slice(1).filter(arg => arg !== '--demo'), '--demo'] }); app.exit(0);
  } });
  ipcMain.on(SETUP_IPC.open, () => open());
  return open;
}
