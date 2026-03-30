import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));

  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    envDir: workspaceRoot,
    envPrefix: ['VITE_', 'NIMI_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('video-food-map'),
    },
    publicDir: false as const,
    resolve: {
      dedupe: ['react', 'react-dom', 'scheduler'],
      alias: [
        { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
        { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
        { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
        { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
        { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
        { find: 'scheduler', replacement: path.resolve(__dirname, 'node_modules/scheduler/index.js') },
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
        { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/nimi-kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
        { find: '@nimiplatform/nimi-kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') }
      ],
    },
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 1425,
      strictPort: true,
      fs: {
        allow: [workspaceRoot, path.resolve(__dirname)],
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');
            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/') || normalizedId.includes('/scheduler/')) {
              return 'vendor-react';
            }
            if (normalizedId.includes('/@tanstack/react-query/') || normalizedId.includes('/@tanstack/query-core/')) {
              return 'vendor-query';
            }
            if (normalizedId.includes('/@tauri-apps/')) {
              return 'vendor-tauri';
            }
            if (normalizedId.includes('/@radix-ui/') || normalizedId.includes('/class-variance-authority/') || normalizedId.includes('/tailwind-merge/')) {
              return 'vendor-platform';
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
