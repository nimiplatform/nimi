import { build } from 'esbuild';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDistRoot = path.join(appRoot, 'dist-electron');

await rm(path.join(electronDistRoot, 'chunks'), { recursive: true, force: true });
await build({
  entryPoints: [path.join(appRoot, 'src-electron/main.ts')],
  outfile: path.join(electronDistRoot, 'main.js'),
  bundle: true,
  packages: 'bundle',
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: [
    'electron',
    '@nimiplatform/kit',
    '@nimiplatform/kit/*',
    '@nimiplatform/sdk',
    '@nimiplatform/sdk/*',
  ],
  logLevel: 'silent',
});

await build({
  entryPoints: [path.join(appRoot, 'src-electron/preload.cts')],
  outfile: path.join(electronDistRoot, 'preload.cjs'),
  bundle: true,
  packages: 'bundle',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'silent',
});

await copyFile(
  path.join(appRoot, 'src', 'shell', 'assets', 'app-icon.png'),
  path.join(electronDistRoot, 'app-icon.png'),
);
