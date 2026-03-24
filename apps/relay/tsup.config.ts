import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      'main/index': 'src/main/index.ts',
    },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    external: ['electron'],
    noExternal: ['@nimiplatform/nimi-kit'],
    esbuildOptions(options) {
      options.loader = {
        ...options.loader,
        '.html': 'text',
      };
    },
  },
  {
    entry: {
      'preload/index': 'src/preload/index.ts',
    },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    external: ['electron'],
  },
]);
