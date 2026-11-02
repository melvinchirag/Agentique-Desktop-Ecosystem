import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { adeDataDir } from '../store/tiger';
import { loadRealCoreEnv } from '../core/realCore';
import { readEnvFile } from '../sponsors/env';
import { SETUP_IPC } from './contracts';
import { completeSetup, verifyBackboardKey } from './setupService';

const mask = (value?: string) => value ? `${value.slice(0, 4)}••••` : null;

export function registerSetup(opts: { preload: string; rendererDir: string; devUrl?: string; envPaths: string[] }): () => void {
  let window: BrowserWindow | undefined;
  let saving = false;
  const file = join(adeDataDir(), '.env');
  const own = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => window && !window.isDestroyed() && event.sender === window.webContents;
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
  ipcMain.handle(SETUP_IPC.verify, (event, key: unknown) => {
    if (!own(event) || typeof key !== 'string' || !key.trim() || key.length > 4096) throw new Error('Enter a Backboard key');
    return verifyBackboardKey(key.trim());
  });
  ipcMain.handle(SETUP_IPC.save, async (event, key: unknown, voice: unknown) => {
    if (!own(event) || typeof key !== 'string' || !key.trim() || key.length > 4096 ||
      (voice !== undefined && (typeof voice !== 'string' || voice.length > 4096))) return { ok: false, error: 'Enter a valid key' };
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
