import { app, BrowserWindow } from 'electron';
import { hubBoundsFor } from './display';
import { SHELL_IPC } from './contracts';
import type { Rect } from './contracts';

export const createHubWindow = (opts: {
  workArea(): Rect;
  preload: string;
  devMode: boolean;
  onLayoutChanged(): void;
}) => {
  const window = new BrowserWindow({
    ...hubBoundsFor(opts.workArea(), false),
    frame: false,
    focusable: true,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: opts.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.setAlwaysOnTop(true, 'floating');
  let collapsed = false;
  let layoutTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleLayout = () => {
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => { layoutTimer = undefined; opts.onLayoutChanged(); }, 50);
  };
  window.on('moved', scheduleLayout);
  window.on('resize', scheduleLayout);
  window.on('closed', () => app.quit());
  window.webContents.once('did-finish-load', () => {
    // DevTools only on request (--devtools or ADE_DEVTOOLS=1); opening it on every dev launch got in the way.
    if (opts.devMode && (process.argv.includes('--devtools') || process.env.ADE_DEVTOOLS === '1')) window.webContents.openDevTools({ mode: 'detach' });
    window.setAlwaysOnTop(true, 'floating');
    if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true, 'screen-saver');
  });
  return {
    window,
    get collapsed() { return collapsed; },
    setCollapsed(on: boolean) {
      if (collapsed === on || window.isDestroyed()) return;
      collapsed = on;
      const current = window.getBounds();
      window.setBounds(hubBoundsFor(opts.workArea(), on, current));
      scheduleLayout();
    },
    focusChat() {
      if (window.isDestroyed()) return;
      window.show();
      window.focus();
      window.webContents.send(SHELL_IPC.hubFocusChat);
    },
    focus() { if (!window.isDestroyed()) { window.show(); window.focus(); } },
    blur() { if (!window.isDestroyed()) window.blur(); },
    destroy() { if (layoutTimer) clearTimeout(layoutTimer); },
  };
};
