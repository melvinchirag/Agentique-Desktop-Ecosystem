const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['renderer/overlay.jsx'],
  outfile: 'dist/overlay.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx' },
  sourcemap: true
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
