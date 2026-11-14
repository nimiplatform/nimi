import { build } from 'esbuild';

await build({ entryPoints: ['src-electron/preload.cts'], outfile: 'dist-electron/preload.cjs', bundle: true,
  platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], logLevel: 'silent' });
