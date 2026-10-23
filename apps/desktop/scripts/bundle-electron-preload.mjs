import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: {
    preload: path.join(appRoot, 'src-electron/preload.cts'),
    'system-entry-preload': path.join(appRoot, 'src-electron/system-entry-preload.cts'),
  },
  outdir: path.join(appRoot, 'dist-electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'silent',
});
