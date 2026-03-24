import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function loadWebBuildEnvFiles(): void {
  if (typeof process.loadEnvFile !== 'function') {
    return;
  }

  const rootEnvPath = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(rootEnvPath)) {
    return;
  }

  try {
    process.loadEnvFile(rootEnvPath);
  } catch {
    // Keep current process env when optional env file is invalid/unreadable.
  }
}

function resolveRealmProxyTarget(env: Record<string, string>): string | null {
  const raw = String(env.NIMI_REALM_URL || process.env.NIMI_REALM_URL || '').trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolveRealtimeProxyTarget(env: Record<string, string>, realmTarget: string | null): string | null {
  const explicit = String(env.NIMI_REALTIME_URL || process.env.NIMI_REALTIME_URL || '').trim();
  if (explicit) {
    try {
      const parsed = new URL(explicit);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.origin;
    } catch {
      return null;
    }
  }

  if (!realmTarget) {
    return null;
  }

  try {
    const parsed = new URL(realmTarget);
    const hostname = parsed.hostname.toLowerCase();
    if ((hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') && parsed.port === '3002') {
      parsed.port = '3003';
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export default defineConfig(({ mode }) => {
  loadWebBuildEnvFiles();
  const env = loadEnv(mode, __dirname, '');
  const realmProxyTarget = resolveRealmProxyTarget(env);
  const realtimeProxyTarget = resolveRealtimeProxyTarget(env, realmProxyTarget);
  return {
    plugins: [react(), tailwindcss()],
    envPrefix: ['VITE_', 'NIMI_'],
    define: {
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('web'),
    },
    optimizeDeps: {
      include: [
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
        'postprocessing',
        'zustand',
        'zustand/traditional',
        'scheduler',
        'use-sync-external-store',
      ],
    },
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'scheduler',
        'zustand',
        'use-sync-external-store',
      ],
      alias: [
        {
          find: '@renderer/infra/bootstrap/runtime-bootstrap',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-bootstrap.web.ts'),
        },
        {
          find: '@renderer/mod-ui/host/slot-host',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/slot-host.web.tsx'),
        },
        {
          find: '@renderer/mod-ui/host/slot-context',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/slot-context.web.ts'),
        },
        {
          find: '@renderer/features/mod-workspace/mod-workspace-tabs',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/mod-workspace-tabs.web.tsx'),
        },
        {
          find: '@renderer/features/runtime-config/runtime-config-panel-view',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-config-panel.web.tsx'),
        },
        {
          find: '@renderer/features/mod-hub/mod-hub-page',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/mod-hub-page.web.tsx'),
        },
        {
          find: /^@renderer\/bridge$/,
          replacement: path.resolve(__dirname, 'src/desktop-adapter/bridge.web.ts'),
        },
        {
          find: /^@runtime\/mod$/,
          replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-mod.web.ts'),
        },
        {
          find: '@runtime',
          replacement: path.resolve(__dirname, '../desktop/src/runtime'),
        },
        {
          find: '@renderer',
          replacement: path.resolve(__dirname, '../desktop/src/shell/renderer'),
        },
        {
          find: /^@nimiplatform\/sdk\/runtime$/,
          replacement: path.resolve(__dirname, '../../sdk/src/runtime/browser.ts'),
        },
        {
          find: '@nimiplatform/sdk',
          replacement: path.resolve(__dirname, '../../sdk/src'),
        },
        {
          find: '@nimiplatform/nimi-kit/core',
          replacement: path.resolve(__dirname, '../../kit/core/src'),
        },
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      proxy: realmProxyTarget
        ? {
            '/api': {
              target: realmProxyTarget,
              changeOrigin: true,
              secure: false,
            },
            '/health': {
              target: realmProxyTarget,
              changeOrigin: true,
              secure: false,
            },
            '/healthz': {
              target: realmProxyTarget,
              changeOrigin: true,
              secure: false,
            },
            '/readyz': {
              target: realmProxyTarget,
              changeOrigin: true,
              secure: false,
            },
            '/socket.io': {
              target: realtimeProxyTarget || realmProxyTarget,
              changeOrigin: true,
              secure: false,
              ws: true,
            },
          }
        : undefined,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          blueyard: path.resolve(__dirname, 'blueyard.html'),
          terms: path.resolve(__dirname, 'terms.html'),
          privacy: path.resolve(__dirname, 'privacy.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');
            if (normalizedId.includes('/sdk/src/runtime/generated/')) {
              if (normalizedId.includes('/sdk/src/runtime/generated/google/')) {
                return 'vendor-sdk-runtime-google';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/ai')) {
                return 'vendor-sdk-runtime-ai-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/local_runtime')) {
                return 'vendor-sdk-runtime-local-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/connector')) {
                return 'vendor-sdk-runtime-connector-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/workflow')) {
                return 'vendor-sdk-runtime-workflow-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/v1/model')) {
                return 'vendor-sdk-runtime-model-generated';
              }
              if (normalizedId.includes('/sdk/src/runtime/generated/runtime/')) {
                return 'vendor-sdk-runtime-generated';
              }
              return 'vendor-sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdk/src/realm/generated/')) {
              return 'vendor-sdk-realm-generated';
            }
            if (normalizedId.includes('/sdk/src/scope/generated/')) {
              return 'vendor-sdk-scope-generated';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'vendor-sdk-client';
            }
            if (normalizedId.includes('/apps/desktop/src/runtime/data-sync/')) {
              return 'vendor-runtime-data-sync';
            }
            if (
              normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge.ts')
            ) {
              return 'vendor-runtime-bridge-core';
            }

            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'vendor-react';
            }
            if (id.includes('/react-router') || id.includes('/@remix-run/router/')) {
              return 'vendor-router';
            }
            if (id.includes('/@tanstack/react-query/')) {
              return 'vendor-query';
            }
            if (id.includes('/i18next/') || id.includes('/react-i18next/')) {
              return 'vendor-i18n';
            }
            if (
              id.includes('/@nimiplatform/sdk')
              || id.includes('/@nimiplatform/nimi-kit/auth/')
              || id.includes('/openapi-fetch/')
            ) {
              return 'vendor-platform';
            }
            if (id.includes('/ai/') || id.includes('/@ai-sdk/')) {
              return 'vendor-ai';
            }
            if (
              id.includes('/three/examples/')
              || id.includes('/three/addons/')
            ) {
              return 'vendor-three-extras';
            }
            if (id.includes('/three/') || id.includes('/simplex-noise/')) {
              return 'vendor-three-core';
            }
            if (
              id.includes('/@react-three/')
              || id.includes('/postprocessing/')
              || id.includes('/three-stdlib/')
            ) {
              return 'vendor-three-react';
            }
            if (
              id.includes('/socket.io-client/')
              || id.includes('/engine.io-client/')
              || id.includes('/socket.io-parser/')
              || id.includes('/engine.io-parser/')
            ) {
              return 'vendor-socket';
            }
            if (
              id.includes('/@protobuf-ts/runtime')
              || id.includes('/@protobuf-ts/runtime-rpc/')
            ) {
              return 'vendor-protobuf';
            }
            if (id.includes('/ajv/') || id.includes('/zod/') || id.includes('/yaml/')) {
              return 'vendor-data';
            }
            return 'vendor-misc';
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
  };
});
