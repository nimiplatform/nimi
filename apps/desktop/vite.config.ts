import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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

function loadDesktopBuildEnvFiles(): void {
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

function resolveFsAllowList(env: Record<string, string>): string[] {
  const desktopRoot = path.resolve(__dirname);
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));
  const runtimeModsDir = resolveOptionalAbsoluteDir(
    env.NIMI_RUNTIME_MODS_DIR || process.env.NIMI_RUNTIME_MODS_DIR,
    'NIMI_RUNTIME_MODS_DIR',
  );
  const results = new Set<string>([
    workspaceRoot,
    desktopRoot,
  ]);
  if (runtimeModsDir) {
    results.add(runtimeModsDir);
  }

  return Array.from(results);
}

function desktopPackageVersion(): string {
  const pkgPath = path.resolve(__dirname, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return String(pkg.version || '').trim() || '0.0.0';
}

export default defineConfig(({ mode }) => {
  loadDesktopBuildEnvFiles();
  const env = loadEnv(mode, __dirname, '');
  const fsAllowList = resolveFsAllowList(env);
  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    envPrefix: ['VITE_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_DESKTOP_VERSION': JSON.stringify(desktopPackageVersion()),
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('desktop'),
    },
    publicDir: false,
    optimizeDeps: {
      // Force Vite to prebundle the react-three -> zustand/traditional chain so
      // the browser never evaluates the raw CJS shim entry as native ESM.
      include: [
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
        'zustand',
        'zustand/traditional',
      ],
    },
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'scheduler',
        'zustand',
      ],
      alias: [
        {
          find: 'react/jsx-dev-runtime',
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: 'react/jsx-runtime',
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        },
        {
          find: 'react-dom/client',
          replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js'),
        },
        {
          find: 'react-dom',
          replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js'),
        },
        {
          find: 'react',
          replacement: path.resolve(__dirname, 'node_modules/react/index.js'),
        },
        {
          find: '@runtime',
          replacement: path.resolve(__dirname, 'src/runtime'),
        },
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
            if (normalizedId.includes('/sdk/src/runtime/generated/')) {
              return 'vendor-sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/apps/desktop/src/runtime/data-sync/')) {
              return 'runtime-data-sync';
            }
            if (
              normalizedId.includes('/apps/desktop/src/runtime/local-runtime/')
              || normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/local-ai')
              || normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/external-agent')
              || normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge.ts')
            ) {
              return 'runtime-bridge';
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
