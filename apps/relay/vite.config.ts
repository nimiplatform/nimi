import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  envPrefix: ['VITE_', 'NIMI_'],
  publicDir: false,
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@nimiplatform/sdk': path.resolve(__dirname, '../../sdk/src'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '127.0.0.1',
    port: 1430,
    strictPort: true,
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        path.resolve(__dirname),
      ],
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 700, // pixi.js lazy chunk is ~620KB
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
