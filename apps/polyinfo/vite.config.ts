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
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('polyinfo'),
    },
    publicDir: false as const,
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
        '@runtime': path.resolve(__dirname, '../desktop/src/runtime'),
        '@nimiplatform/sdk': path.resolve(__dirname, '../../sdk/src'),
        '@nimiplatform/nimi-kit/features/chat': path.resolve(__dirname, '../../kit/features/chat/src'),
        '@nimiplatform/nimi-kit/core': path.resolve(__dirname, '../../kit/core/src'),
        '@nimiplatform/nimi-kit/auth': path.resolve(__dirname, '../../kit/auth/src'),
        '@nimiplatform/nimi-kit/shell/renderer/bridge': path.resolve(__dirname, '../../kit/shell/renderer/src/bridge'),
      },
    },
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 1426,
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
            if (!id.includes('node_modules') && !id.includes('/sdk/src/') && !id.includes('/kit/')) {
              return undefined;
            }
            if (id.includes('/react/') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-vendor';
            }
            if (id.includes('@tanstack/react-query') || id.includes('zustand')) {
              return 'state-vendor';
            }
            if (id.includes('/sdk/src/') || id.includes('/kit/')) {
              return 'nimi-platform';
            }
            return 'vendor';
          },
        },
      },
    },
  };
});
