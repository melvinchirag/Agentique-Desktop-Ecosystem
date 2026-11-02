import { app, globalShortcut, Menu, nativeImage, Tray } from 'electron';

/** A 16x16 teal dot drawn in code, so the tray needs no image file. Pixels are BGRA. */
function dotIcon(): Electron.NativeImage {
  const size = 16, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5), i = (y * size + x) * 4;
    if (d <= 7) { buf[i] = 0xc0; buf[i + 1] = 0xd1; buf[i + 2] = 0x4f; buf[i + 3] = d > 6 ? 0x80 : 0xff; }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export const QUIT_SHORTCUT = 'CommandOrControl+Shift+Q';

/**
 * ADE has no window frame and no taskbar button, so it needs an obvious way out:
 * a tray icon (Show Hub, Hide/Show animals, Quit ADE) and Ctrl+Shift+Q, which always quits.
 */
export function createTray(opts: { showHub(): void; animalsHidden(): boolean; toggleAnimals(): void }): () => void {
  const tray = new Tray(dotIcon());
  tray.setToolTip('ADE (right-click to quit)');
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Hub', click: () => opts.showHub() },
    { label: opts.animalsHidden() ? 'Show animals' : 'Hide animals', click: () => { opts.toggleAnimals(); rebuild(); } },
    { type: 'separator' },
    { label: 'Quit ADE', accelerator: QUIT_SHORTCUT, click: () => app.quit() },
  ]));
  rebuild();
  tray.on('click', () => opts.showHub());
  globalShortcut.register(QUIT_SHORTCUT, () => app.quit());
  return () => { globalShortcut.unregister(QUIT_SHORTCUT); if (!tray.isDestroyed()) tray.destroy(); };
}
