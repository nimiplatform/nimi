import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    alias: [
      { find: '@nimiplatform/kit/core', replacement: path.join(repoRoot, 'kit/core/src') },
      { find: '@nimiplatform/kit/shell/capabilities', replacement: path.join(repoRoot, 'kit/shell/capabilities/src') },
      { find: '@nimiplatform/kit/shell/renderer/bridge', replacement: path.join(repoRoot, 'kit/shell/renderer/src/bridge') },
    ],
  },
  optimizeDeps: {
    exclude: [
      '@nimiplatform/kit/core',
      '@nimiplatform/kit/shell/capabilities',
      '@nimiplatform/kit/shell/renderer/bridge',
    ],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
