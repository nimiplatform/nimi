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
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('realm-drift'),
    },
    publicDir: false as const,
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
        '@runtime': path.resolve(__dirname, 'src/runtime'),
        '@nimiplatform/sdk': path.resolve(__dirname, '../../sdk/src'),
        '@nimiplatform/nimi-kit/features/chat': path.resolve(__dirname, '../../kit/features/chat/src'),
        '@nimiplatform/nimi-kit/core': path.resolve(__dirname, '../../kit/core/src'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1424,
      strictPort: true,
      fs: {
        allow: [workspaceRoot, path.resolve(__dirname)],
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run/router')) {
              return 'vendor-router';
            }
            if (id.includes('node_modules/@tanstack/react-query')) {
              return 'vendor-query';
            }
            if (id.includes('node_modules/zustand')) {
              return 'vendor-state';
            }
            if (id.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (id.includes('/bridge/')) {
              return 'runtime-bridge';
            }
            if (id.includes('node_modules/')) {
              return 'vendor-misc';
            }
            return undefined;
          },
        },
      },
    },
  };
});
