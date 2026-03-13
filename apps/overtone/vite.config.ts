import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));

  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    envPrefix: ['VITE_', 'NIMI_'],
    define: {
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('desktop'),
    },
    publicDir: false as const,
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
        '@nimiplatform/sdk': path.resolve(__dirname, '../../sdk/src'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1421,
      strictPort: true,
      fs: {
        allow: [workspaceRoot, path.resolve(__dirname)],
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-sdk': ['zustand', '@tanstack/react-query'],
          },
        },
      },
    },
  };
});
