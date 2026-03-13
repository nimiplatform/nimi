import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
      '@nimiplatform/sdk': path.resolve(__dirname, '../../sdk/src'),
    },
  },
});
