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
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('desktop'),
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
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
        { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/src') },
        { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/nimi-kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src') },
        { find: '@nimiplatform/nimi-kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
      ],
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
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');

            if (normalizedId.includes('/sdk/src/runtime/generated/')) {
              if (normalizedId.includes('/sdk/src/runtime/generated/google/')) {
                return 'sdk-runtime-google';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/ai')) {
                return 'sdk-runtime-ai-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/local_runtime')) {
                return 'sdk-runtime-local-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/connector')) {
                return 'sdk-runtime-connector-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/workflow')) {
                return 'sdk-runtime-workflow-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/model')) {
                return 'sdk-runtime-model-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/')) {
                return 'sdk-runtime-generated';
              }
              return 'sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdk/src/realm/generated/')) {
              return 'sdk-realm-generated';
            }
            if (normalizedId.includes('/sdk/src/scope/generated/')) {
              return 'sdk-scope-generated';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/kit/auth/src/')) {
              return 'shell-auth';
            }
            if (normalizedId.includes('/kit/ui/src/')) {
              return 'vendor-platform';
            }
            if (normalizedId.includes('/apps/overtone/src/shell/renderer/bridge/')) {
              return 'runtime-bridge';
            }
            if (normalizedId.includes('/apps/overtone/src/shell/renderer/features/workspace/')) {
              return 'workspace';
            }
            if (normalizedId.includes('/apps/overtone/src/shell/renderer/app-shell/')) {
              return 'app-shell';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/') || normalizedId.includes('/scheduler/')) {
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
            if (normalizedId.includes('/i18next/') || normalizedId.includes('/react-i18next/')) {
              return 'vendor-i18n';
            }
            if (normalizedId.includes('/@protobuf-ts/runtime') || normalizedId.includes('/@protobuf-ts/runtime-rpc/')) {
              return 'vendor-protobuf';
            }
            if (normalizedId.includes('/three/') || normalizedId.includes('/simplex-noise/')) {
              return 'vendor-three';
            }
            if (
              normalizedId.includes('/@nimiplatform/nimi-kit/auth/')
              || normalizedId.includes('/@nimiplatform/sdk/')
              || normalizedId.includes('/openapi-fetch/')
            ) {
              return 'vendor-platform';
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
