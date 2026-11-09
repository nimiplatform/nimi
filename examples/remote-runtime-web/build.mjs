import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await build({ entryPoints: ['src/client.ts'], bundle: true, format: 'esm', platform: 'browser',
  target: ['es2022'], outfile: 'dist/client.js', sourcemap: true });
await copyFile('index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/styles.css');
