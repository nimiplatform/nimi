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
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('forge'),
    },
    publicDir: false as const,
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
        '@runtime': path.resolve(__dirname, 'src/runtime'),
        '@nimiplatform/sdk': path.resolve(__dirname, '../../sdk/src'),
        '@nimiplatform/shell-auth': path.resolve(__dirname, '../_libs/shell-auth/src'),
        '@nimiplatform/shell-core': path.resolve(__dirname, '../_libs/shell-core/src'),
        '@world-engine': path.resolve(__dirname, '../../nimi-mods/runtime/world-studio/src'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1422,
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
            if (normalizedId.includes('/apps/_libs/shell-auth/src/')) {
              return 'shell-auth';
            }
            if (normalizedId.includes('nimi-mods/runtime/world-studio/src/')) {
              return 'world-engine';
            }
            if (normalizedId.includes('/bridge/')) {
              return 'runtime-bridge';
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
              normalizedId.includes('/@nimiplatform/shell-auth/')
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
