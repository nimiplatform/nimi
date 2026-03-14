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
  const externalStoreShimPath = path.resolve(
    __dirname,
    '../desktop/src/shell/renderer/compat/use-sync-external-store-shim.ts',
  );
  const externalStoreShimWithSelectorPath = path.resolve(
    __dirname,
    '../desktop/src/shell/renderer/compat/use-sync-external-store-shim-with-selector.ts',
  );

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
        'use-sync-external-store/shim/with-selector',
        'use-sync-external-store/shim/with-selector.js',
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
        // Match desktop dev behavior when the shared renderer pulls raw /@fs deps.
        {
          find: /^use-sync-external-store\/shim\/with-selector\.js$/,
          replacement: externalStoreShimWithSelectorPath,
        },
        {
          find: /^use-sync-external-store\/shim\/with-selector$/,
          replacement: externalStoreShimWithSelectorPath,
        },
        {
          find: /^use-sync-external-store\/shim$/,
          replacement: externalStoreShimPath,
        },
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
          find: '@nimiplatform/sdk',
          replacement: path.resolve(__dirname, '../../sdk/src'),
        },
        {
          find: '@nimiplatform/shell-core',
          replacement: path.resolve(__dirname, '../_libs/shell-core/src'),
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
              return 'vendor-sdk-runtime-generated';
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
            if (id.includes('/@nimiplatform/sdk') || id.includes('/ai/') || id.includes('/@ai-sdk/')) {
              return 'vendor-ai';
            }
            if (id.includes('/three/') || id.includes('/simplex-noise/')) {
              return 'vendor-3d';
            }
            if (id.includes('/zustand/')) {
              return 'vendor-state';
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
