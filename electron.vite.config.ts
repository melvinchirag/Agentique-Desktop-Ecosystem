import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const sfxRoot = resolve('resources/sfx');
async function sfxFiles(dir = sfxRoot): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? sfxFiles(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}

const sfxAssets = () => ({
  name: 'sfx-assets',
  configureServer(server: { middlewares: { use: (path: string, handler: (req: { url?: string }, res: { statusCode: number; setHeader: (key: string, value: string) => void; end: (data?: Uint8Array) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use('/sfx', (req, res, next) => {
      const path = resolve(sfxRoot, `.${decodeURIComponent(req.url ?? '')}`);
      if (path !== sfxRoot && !path.startsWith(`${sfxRoot}\\`)) { res.statusCode = 403; res.end(); return; }
      void readFile(path).then(data => {
        res.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'audio/mpeg'); res.end(data);
      }).catch(() => next());
    });
  },
  async generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Uint8Array }) => void }) {
    for (const file of await sfxFiles()) this.emitFile({ type: 'asset', fileName: `sfx/${relative(sfxRoot, file).replace(/\\/g, '/')}`, source: await readFile(file) });
  },
});

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    publicDir: resolve('src/renderer/public'),
    plugins: [react(), sfxAssets(), {
      name: 'dev-csp-websocket',
      apply: 'serve',
      transformIndexHtml: html => html.replace("connect-src 'self' data: blob:", "connect-src 'self' data: blob: ws:"),
    }],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve('src/renderer/overlay.html'),
          hub: resolve('src/renderer/hub.html'),
          assetlab: resolve('src/renderer/assetlab.html'),
        },
      },
    },
  },
});
