import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'scheduler'],
    alias: [
      { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
      { find: '@nimiplatform/kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
      { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdk/src/realm/index.ts') },
    ],
  },
});
