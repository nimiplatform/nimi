import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(appRoot, 'src-electron/main.ts')],
  outfile: path.join(appRoot, 'dist-electron/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: [
    'electron',
    '@nimiplatform/*',
    'yaml',
  ],
  logLevel: 'silent',
});
