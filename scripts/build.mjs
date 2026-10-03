import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });
await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
  sourcemap: true,
});
await build({
  entryPoints: ['scripts/maintenance.ts'],
  outfile: 'dist/maintenance.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
await build({
  entryPoints: ['src/client/app.ts'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  target: ['safari15', 'chrome100'],
  minify: true,
  sourcemap: true,
});
for (const file of ['index.html', 'app.css', 'favicon.svg'])
  await copyFile('src/client/' + file, 'dist/public/' + file);
