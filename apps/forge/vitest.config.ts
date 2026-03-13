import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
      '@runtime': path.resolve(__dirname, 'src/runtime'),
      '@nimiplatform/sdk': path.resolve(__dirname, '../../sdk/src'),
      '@nimiplatform/shell-core': path.resolve(__dirname, '../_libs/shell-core/src'),
      '@world-engine': path.resolve(__dirname, '../../nimi-mods/runtime/world-studio/src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: [],
  },
});
