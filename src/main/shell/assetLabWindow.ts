import { BrowserWindow } from 'electron';
import { join } from 'node:path';

export const createAssetLabWindow = (opts: {
  preload: string;
  rendererDir: string;
  devUrl?: string;
  onCreated?(window: BrowserWindow): void;
}) => {
  let window: BrowserWindow | undefined;
  return {
    get window() { return window && !window.isDestroyed() ? window : undefined; },
    open() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return window; }
      window = new BrowserWindow({
        width: 1100, height: 750,
        frame: true, focusable: true, resizable: true,
        webPreferences: {
          preload: opts.preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      opts.onCreated?.(window);
      const created = window;
      created.on('closed', () => { if (window === created) window = undefined; });
      if (opts.devUrl) void created.loadURL(`${opts.devUrl}/assetlab.html`);
      else void created.loadFile(join(opts.rendererDir, 'assetlab.html'));
      return created;
    },
  };
};
