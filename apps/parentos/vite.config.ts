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
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('parentos'),
    },
    publicDir: false as const,
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react-i18next',
        'scheduler',
        'zustand',
        '@nimiplatform/sdk',
      ],
      alias: [
        { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
        { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
        { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
        { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
        { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
        { find: '@engine', replacement: path.resolve(__dirname, 'src/shell/renderer/engine') },
        { find: '@nimiplatform/sdk/runtime/browser', replacement: path.resolve(__dirname, '../../sdk/src/runtime/browser.ts') },
        { find: '@nimiplatform/sdk/runtime', replacement: path.resolve(__dirname, '../../sdk/src/runtime/index.ts') },
        { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdk/src/realm/index.ts') },
        { find: '@nimiplatform/sdk/types', replacement: path.resolve(__dirname, '../../sdk/src/types/index.ts') },
        { find: '@nimiplatform/sdk/ai-provider', replacement: path.resolve(__dirname, '../../sdk/src/ai-provider/index.ts') },
        { find: '@nimiplatform/sdk/scope', replacement: path.resolve(__dirname, '../../sdk/src/scope/index.ts') },
        { find: '@nimiplatform/sdk/mod/lifecycle', replacement: path.resolve(__dirname, '../../sdk/src/mod/lifecycle.ts') },
        { find: '@nimiplatform/sdk/mod/shell', replacement: path.resolve(__dirname, '../../sdk/src/mod/shell.ts') },
        { find: '@nimiplatform/sdk/mod/storage', replacement: path.resolve(__dirname, '../../sdk/src/mod/storage/index.ts') },
        { find: '@nimiplatform/sdk/mod', replacement: path.resolve(__dirname, '../../sdk/src/mod/index.ts') },
        { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/src/index.ts') },
        { find: '@nimiplatform/nimi-kit/features/model-picker', replacement: path.resolve(__dirname, '../../kit/features/model-picker/src') },
        { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/nimi-kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src') },
        { find: '@nimiplatform/nimi-kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
        { find: '@nimiplatform/nimi-kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
        { find: '@nimiplatform/nimi-kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
      ],
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
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

            if (normalizedId.includes('/sdk/src/runtime/generated/')) {
              return 'sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdk/src/realm/generated/')) {
              return 'sdk-realm-generated';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/kit/auth/src/')) {
              return 'shell-auth';
            }
            if (normalizedId.includes('/kit/ui/src/') || normalizedId.includes('/kit/features/')) {
              return 'vendor-platform';
            }
            if (normalizedId.includes('/bridge/')) {
              return 'runtime-bridge';
            }
            if (normalizedId.includes('/engine/')) {
              return 'reminder-engine';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            if (normalizedId.includes('/react-dom/') || normalizedId.includes('/react/') || normalizedId.includes('/scheduler/')) {
              return 'vendor-react';
            }
            if (normalizedId.includes('/react-router') || normalizedId.includes('/@remix-run/router/')) {
              return 'vendor-router';
            }
            if (normalizedId.includes('/@tanstack/react-query/') || normalizedId.includes('/@tanstack/query-core/')) {
              return 'vendor-query';
            }
            if (normalizedId.includes('/zustand/')) {
              return 'vendor-state';
            }
            if (normalizedId.includes('/recharts/') || normalizedId.includes('/d3-')) {
              return 'vendor-charts';
            }
            if (normalizedId.includes('/i18next/') || normalizedId.includes('/react-i18next/')) {
              return 'vendor-i18n';
            }
            if (normalizedId.includes('/@protobuf-ts/')) {
              return 'vendor-protobuf';
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
