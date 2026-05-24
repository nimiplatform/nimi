import path from 'node:path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
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
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('realm-agent-studio'),
    },
    publicDir: false as const,
    resolve: {
      dedupe: ['react', 'react-dom', 'scheduler'],
      alias: [
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
        { find: '@nimiplatform/kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdk/src/realm/index.ts') },
      ],
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
            const normalizedId = id.split(path.sep).join('/');
            if (normalizedId.includes('/sdk/src/realm/')) return 'sdk-realm';
            if (normalizedId.includes('/kit/ui/src/')) return 'vendor-platform';
            if (!normalizedId.includes('node_modules')) return undefined;
            if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/') || normalizedId.includes('/scheduler/')) return 'vendor-react';
            if (normalizedId.includes('/@tanstack/react-query/') || normalizedId.includes('/@tanstack/query-core/')) return 'vendor-query';
            if (normalizedId.includes('/@radix-ui/') || normalizedId.includes('/class-variance-authority/') || normalizedId.includes('/tailwind-merge/')) return 'vendor-platform';
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
