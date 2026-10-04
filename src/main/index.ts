import { app, BrowserWindow, ipcMain, screen, session } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeCore } from './fake';
import { registerCoreIpc } from './ipc/registerCoreIpc';
import { SHELL_IPC } from './shell/contracts';
import type { DisplayLayout } from './shell/contracts';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isFocusable())?.focus());
  app.whenReady().then(async () => {
    const mainDir = fileURLToPath(new URL('.', import.meta.url));
    const preload = join(mainDir, '../preload/index.cjs');
    const workArea = screen.getPrimaryDisplay().workArea;
    const hubBounds = { x: workArea.x + workArea.width - 360 - 16, y: workArea.y + 16, width: 360, height: 560 };
    const commonPreferences = {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    };
    const overlay = new BrowserWindow({
      ...workArea,
      transparent: true,
      frame: false,
      backgroundColor: '#00000000',
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      thickFrame: false,
      alwaysOnTop: true,
      webPreferences: commonPreferences,
    });
    overlay.setAlwaysOnTop(true, 'floating');
    overlay.setIgnoreMouseEvents(true, { forward: true });
    const hub = new BrowserWindow({
      ...hubBounds,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: true,
      webPreferences: commonPreferences,
    });
    hub.setAlwaysOnTop(true, 'floating');
    hub.on('closed', () => app.quit());

    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(permission === 'media' && (contents === overlay.webContents || contents === hub.webContents));
    });

    const adapter = createFakeCore();
    const unregister = registerCoreIpc(adapter, {
      ipc: ipcMain,
      targets: () => [overlay, hub].filter(w => !w.isDestroyed()).map(w => w.webContents),
    });
    app.once('will-quit', () => { unregister(); adapter.dispose?.(); });

    const layout = (): DisplayLayout => {
      const display = screen.getPrimaryDisplay();
      return {
        workArea: display.workArea,
        displayBounds: display.bounds,
        scaleFactor: display.scaleFactor,
        hubBounds: hub.getBounds(),
        hubCollapsed: hub.getBounds().height <= 56,
        animalsHidden: !overlay.isVisible(),
        demoMode: false,
        devMode: !app.isPackaged || process.argv.includes('--dev'),
      };
    };
    ipcMain.handle(SHELL_IPC.getLayout, layout);
    ipcMain.on(SHELL_IPC.setInteractive, (event, on: boolean) => {
      if (event.sender === overlay.webContents) overlay.setIgnoreMouseEvents(!on, on ? undefined : { forward: true });
    });
    ipcMain.on(SHELL_IPC.publishHitShapes, () => {});
    ipcMain.on(SHELL_IPC.hubFocusChat, () => { hub.focus(); hub.webContents.send(SHELL_IPC.hubFocusChat); });
    ipcMain.on(SHELL_IPC.openHubTab, (_event, ...args) => hub.webContents.send(SHELL_IPC.openHubTab, ...args));
    ipcMain.on(SHELL_IPC.inspectAgent, (_event, ...args) => overlay.webContents.send(SHELL_IPC.inspectAgent, ...args));
    ipcMain.on(SHELL_IPC.openAssetLab, () => {});
    ipcMain.on(SHELL_IPC.hideAnimals, (_event, on: boolean) => on ? overlay.hide() : overlay.showInactive());
    ipcMain.on(SHELL_IPC.blurHub, event => { if (event.sender === hub.webContents) hub.blur(); });
    ipcMain.on(SHELL_IPC.setHubCollapsed, (event, collapsed: boolean) => {
      if (event.sender === hub.webContents) hub.setSize(360, collapsed ? 56 : 560);
    });

    const load = (window: BrowserWindow, page: string) => {
      const finished = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()));
      const devUrl = process.env.ELECTRON_RENDERER_URL;
      const loading = devUrl
        ? window.loadURL(`${devUrl}/${page}`)
        : window.loadFile(join(mainDir, `../renderer/${page}`));
      return loading.then(() => finished);
    };
    await Promise.all([load(overlay, 'overlay.html'), load(hub, 'hub.html')]);
    adapter.start?.();
  }).catch(error => { console.error('[shell] startup failed', error); app.quit(); });
}
