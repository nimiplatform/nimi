import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function resolveRequiredAbsoluteDir(raw: string | undefined, envName: string): string {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    throw new Error(`Missing required env ${envName}.`);
  }
  if (!path.isAbsolute(normalized)) {
    throw new Error(`${envName} must be an absolute path. Received: ${normalized}`);
  }
  const resolved = path.resolve(normalized);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${envName} must point to an existing directory. Received: ${resolved}`);
  }
  return resolved;
}

function resolveOptionalAbsoluteDir(raw: string | undefined, envName: string): string | null {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return null;
  }
  if (!path.isAbsolute(normalized)) {
    throw new Error(`${envName} must be an absolute path. Received: ${normalized}`);
  }
  const resolved = path.resolve(normalized);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${envName} must point to an existing directory. Received: ${resolved}`);
  }
  return resolved;
}

function resolveFsAllowList(env: Record<string, string>): string[] {
  const desktopRoot = path.resolve(__dirname);
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));
  const modsRoot = resolveRequiredAbsoluteDir(
    env.NIMI_MODS_ROOT || process.env.NIMI_MODS_ROOT,
    'NIMI_MODS_ROOT',
  );
  const runtimeModsDir = resolveOptionalAbsoluteDir(
    env.NIMI_RUNTIME_MODS_DIR || process.env.NIMI_RUNTIME_MODS_DIR,
    'NIMI_RUNTIME_MODS_DIR',
  );
  const results = new Set<string>([
    workspaceRoot,
    desktopRoot,
    modsRoot,
  ]);
  if (runtimeModsDir) {
    results.add(runtimeModsDir);
  }

  return Array.from(results);
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const fsAllowList = resolveFsAllowList(env);

  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    publicDir: false,
    resolve: {
      alias: {
        '@runtime': path.resolve(__dirname, 'src/runtime'),
        '@renderer': path.resolve(__dirname, 'src/shell/renderer'),
        '@mods': path.resolve(__dirname, 'src/mods'),
        '@nimiplatform/mod-sdk': path.resolve(__dirname, '../../sdk/packages/mod-sdk/src'),
        '@nimiplatform/shell-core': path.resolve(__dirname, '../_libs/shell-core/src'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      fs: {
        allow: fsAllowList,
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
            if (normalizedId.includes('/sdk/packages/runtime/src/generated/')) {
              return 'sdk-runtime-generated';
            }
            if (
              normalizedId.includes('/sdk/packages/runtime/src/core/')
              || normalizedId.includes('/sdk/packages/runtime/src/transports/')
              || normalizedId.includes('/sdk/packages/runtime/src/errors.ts')
              || normalizedId.includes('/sdk/packages/runtime/src/method-ids.ts')
              || normalizedId.includes('/sdk/packages/runtime/src/workflow-builder.ts')
            ) {
              return 'sdk-runtime-core';
            }
            if (normalizedId.includes('/sdk/packages/sdk/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/sdk/packages/types/src/')) {
              return 'sdk-types';
            }
            if (normalizedId.includes('/apps/desktop/src/runtime/data-sync/')) {
              return 'runtime-data-sync';
            }
            if (normalizedId.includes('/apps/desktop/src/runtime/local-ai-runtime/')) {
              return 'runtime-local-ai';
            }
            if (normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/local-ai')) {
              return 'runtime-bridge-local-ai';
            }
            if (normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/external-agent')) {
              return 'runtime-bridge-external-agent';
            }
            if (
              normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge.ts')
            ) {
              return 'runtime-bridge-core';
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
