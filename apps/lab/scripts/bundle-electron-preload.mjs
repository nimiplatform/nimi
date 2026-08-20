import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(appRoot, 'src-electron/preload.cts')],
  outfile: path.join(appRoot, 'dist-electron/preload.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'silent',
});
