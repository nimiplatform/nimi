import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
