import { shell, session } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const installPermissions = (opts: {
  overlay: BrowserWindow;
  hub: BrowserWindow;
  rendererDir: string;
  devUrl?: string;
}) => {
  const origin = opts.devUrl ? new URL(opts.devUrl).origin : undefined;
  const ownPages = new Set(['overlay.html', 'hub.html', 'assetlab.html'].map(page =>
    opts.devUrl ? new URL(page, `${opts.devUrl}/`).href : pathToFileURL(join(opts.rendererDir, page)).href,
  ));
  const ownUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (origin && parsed.origin !== origin) return false;
      return ownPages.has(parsed.href);
    } catch { return false; }
  };
  const trustedMedia = (contents: WebContents | null, url: string) =>
    !!contents && (contents === opts.overlay.webContents || contents === opts.hub.webContents) && ownUrl(url);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'media' && trustedMedia(contents, details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    permission === 'media' && trustedMedia(contents, contents?.getURL() ?? '') &&
    (origin ? requestingOrigin === origin : requestingOrigin.startsWith('file://')),
  );
  return (window: BrowserWindow) => {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https:')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (!ownUrl(url)) event.preventDefault();
    });
  };
};
