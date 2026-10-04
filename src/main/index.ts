import { app, ipcMain, shell, safeStorage } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealCore } from './core/realCore';
import { registerCoreIpc } from './ipc/registerCoreIpc';
import { createAssetLabWindow } from './shell/assetLabWindow';
import { SHELL_IPC } from './shell/contracts';
import type { CoreAdapter, DisplayLayout, WebContentsLike } from './shell/contracts';
import { createDemoShortcuts } from './shell/demoShortcuts';
import { buildDisplayLayout, readDisplay, watchDisplay } from './shell/display';
import { createHubWindow } from './shell/hubWindow';
import { createOverlayWindow } from './shell/overlayWindow';
import { installPermissions } from './shell/permissions';
import { registerShellIpc } from './shell/shellIpc';
import { watchSettings } from './shell/settingsWatch';

const argv = process.argv;
const devMode = !app.isPackaged || argv.includes('--dev');
const demoMode = argv.includes('--demo');
if (argv.includes('--no-gpu')) app.disableHardwareAcceleration();

const option = (name: string) => {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
};

let focusExistingHub: (() => void) | undefined;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusExistingHub?.());
  app.whenReady().then(async () => {
    const mainDir = fileURLToPath(new URL('.', import.meta.url));
    const rendererDir = join(mainDir, '../renderer');
    const preload = join(mainDir, '../preload/index.cjs');
    const resourcesDir = app.isPackaged ? process.resourcesPath : join(mainDir, '../../resources');
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const display = readDisplay();
    const pointerMode = option('--pointer') === 'poll' || process.env.ADE_POINTER === 'poll' ? 'poll' : 'forward';
    const { window: overlay, controller } = createOverlayWindow({
      workArea: display.workArea,
      preload,
      pointerMode,
      level: option('--level') === 'screen-saver' ? 'screen-saver' : 'floating',
      toolbar: argv.includes('--toolbar'),
    });
    let settingsDemoMode = demoMode;
    let animalsHidden = false;
    let coreRef: CoreAdapter | undefined;
    const targets = (): readonly WebContentsLike[] => [overlay, hub.window, assetLab.window]
      .filter(window => window && !window.isDestroyed()).map(window => window!.webContents);
    const layout = (): DisplayLayout => buildDisplayLayout(readDisplay(), hub.window.getBounds(), {
      hubCollapsed: hub.collapsed,
      animalsHidden,
      demoMode: settingsDemoMode,
      devMode,
    });
    const broadcastLayout = () => {
      const value = layout();
      for (const target of targets()) if (!target.isDestroyed()) target.send(SHELL_IPC.layoutChanged, value);
    };
    const hub = createHubWindow({
      workArea: () => readDisplay().workArea,
      preload, devMode, onLayoutChanged: broadcastLayout,
    });
    focusExistingHub = hub.focus;
    const guard = installPermissions({ overlay, hub: hub.window, rendererDir, devUrl });
    guard(overlay);
    guard(hub.window);
    const assetLab = createAssetLabWindow({ preload, rendererDir, devUrl, onCreated: guard });
    const setAnimalsHidden = (on: boolean) => {
      if (animalsHidden === on) return;
      animalsHidden = on;
      controller.setHidden(on);
      broadcastLayout();
    };
    const shortcuts = createDemoShortcuts({
      core: () => coreRef,
      targets,
      openAssetLab: () => { assetLab.open(); },
      toggleHidden: () => setAnimalsHidden(!animalsHidden),
    });
    const onSettings = (settings: Awaited<ReturnType<CoreAdapter['getSettings']>>) => {
      settingsDemoMode = settings.demoMode;
      shortcuts.update(settingsDemoMode, devMode);
      for (const target of targets()) if (!target.isDestroyed()) target.send(SHELL_IPC.settingsChanged, settings);
      broadcastLayout();
    };
    const disposeShellIpc = registerShellIpc({
      overlay, hub: hub.window, controller, layout,
      focusChat: hub.focusChat, focusHub: hub.focus, blurHub: hub.blur,
      setHubCollapsed: hub.setCollapsed,
      openAssetLab: () => { assetLab.open(); },
      setAnimalsHidden,
    });
    const disposeDisplay = watchDisplay({
      overlay, hub: hub.window, isCollapsed: () => hub.collapsed, layout, targets,
    });
    const core = watchSettings(createRealCore({ demoMode, demoTimers: argv.includes('--demo-timers'), resourcesDir,
      desktopRoot: app.getPath('desktop'), documentsRoot: app.getPath('documents'), downloadsRoot: app.getPath('downloads'),
      safeStorage, fsShell: shell, openExternal: url => shell.openExternal(url), onSettingsChanged: onSettings }), onSettings);
    coreRef = core;
    const disposeCoreIpc = registerCoreIpc(core, { ipc: ipcMain, targets });
    shortcuts.update(settingsDemoMode, devMode);
    app.once('will-quit', shortcuts.dispose);
    app.once('before-quit', () => {
      disposeDisplay();
      disposeShellIpc();
      disposeCoreIpc();
      shortcuts.dispose();
      hub.destroy();
      controller.destroy();
      core.dispose?.();
    });
    const load = (window: typeof overlay, page: string) => {
      const finished = new Promise<void>(resolve => window.webContents.once('did-finish-load', () => resolve()));
      const loading = devUrl ? window.loadURL(`${devUrl}/${page}`) : window.loadFile(join(rendererDir, page));
      return loading.then(() => finished);
    };
    await Promise.all([load(overlay, 'overlay.html'), load(hub.window, 'hub.html')]);
    onSettings(await core.getSettings());
    core.start?.();
    broadcastLayout();
  }).catch(error => { console.error('[shell] startup failed', error); app.quit(); });
}
