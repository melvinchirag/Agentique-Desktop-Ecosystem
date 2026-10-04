import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react(), {
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
