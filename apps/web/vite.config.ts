import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createWebPublicEnvDefines, resolveWebPublicEnv } from './public-env.js';

const repoRoot = path.resolve(__dirname, '../..');
const repoRootNormalized = repoRoot.replaceAll('\\', '/');

function manualChunks(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');

  if (
    normalized.includes('/node_modules/react/')
    || normalized.includes('/node_modules/react-dom/')
    || normalized.includes('/node_modules/scheduler/')
  ) {
    return 'vendor-react';
  }
  if (normalized.includes('/node_modules/react-router/')) {
    return 'vendor-router';
  }
  if (
    normalized.includes('/node_modules/i18next/')
    || normalized.includes('/node_modules/react-i18next/')
  ) {
    return 'vendor-i18n';
  }
  if (normalized.includes('/node_modules/@protobuf-ts/')) {
    return 'vendor-protobuf';
  }
  if (
    normalized.includes('/node_modules/three/')
    || normalized.includes('/node_modules/@react-three/')
    || normalized.includes('/node_modules/postprocessing/')
    || normalized.includes('/node_modules/three-stdlib/')
    || normalized.includes('/node_modules/maath/')
    || normalized.includes('/node_modules/zustand/')
  ) {
    return 'vendor-three';
  }

  const isNimiSdk =
    normalized.includes('/node_modules/@nimiplatform/sdk/')
    || normalized.startsWith(`${repoRootNormalized}/sdks/typescript/`);
  if (isNimiSdk) {
    return 'vendor-nimi-sdk';
  }

  if (
    normalized.includes('/node_modules/@nimiplatform/kit/')
    || normalized.startsWith(`${repoRootNormalized}/kit/`)
  ) {
    return 'vendor-nimi-kit';
  }
  return undefined;
}

function loadRootEnv(): void {
  if (typeof process.loadEnvFile !== 'function') return;
  const file = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(file)) return;
  try { process.loadEnvFile(file); } catch { /* optional local input */ }
}

function httpOrigin(value: unknown): string | null {
  try {
    const parsed = new URL(String(value || '').trim());
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback) ? parsed.origin : null;
  } catch {
    return null;
  }
}

export default defineConfig(({ mode }) => {
  loadRootEnv();
  const env = loadEnv(mode, __dirname, '');
  const realmProxyTarget = httpOrigin(env.NIMI_REALM_URL || process.env.NIMI_REALM_URL);
  const publicEnv = resolveWebPublicEnv({ source: { ...process.env, ...env }, realmProxyTarget, mode });
  const sdkDist = path.resolve(__dirname, '../../sdks/typescript/dist');
  return {
    plugins: [react(), tailwindcss()],
    envPrefix: [],
    define: createWebPublicEnvDefines(publicEnv),
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        { find: /^@nimiplatform\/kit\/auth\/styles\.css$/, replacement: path.resolve(__dirname, '../../kit/auth/src/styles.css') },
        { find: /^@nimiplatform\/kit\/auth$/, replacement: path.resolve(__dirname, '../../kit/auth/src/index.ts') },
        { find: /^@nimiplatform\/kit\/core\/(.*)$/, replacement: path.resolve(__dirname, '../../kit/core/src/$1') },
        { find: /^@nimiplatform\/sdk\/realm$/, replacement: path.join(sdkDist, 'realm/index.js') },
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      proxy: realmProxyTarget ? {
        '/api': { target: realmProxyTarget, changeOrigin: true, secure: false },
        '/health': { target: realmProxyTarget, changeOrigin: true, secure: false },
        '/healthz': { target: realmProxyTarget, changeOrigin: true, secure: false },
        '/readyz': { target: realmProxyTarget, changeOrigin: true, secure: false },
      } : undefined,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          download: path.resolve(__dirname, 'download.html'),
          codeSigning: path.resolve(__dirname, 'code-signing.html'),
          blueyard: path.resolve(__dirname, 'blueyard.html'),
          terms: path.resolve(__dirname, 'terms.html'),
          privacy: path.resolve(__dirname, 'privacy.html'),
        },
        output: {
          manualChunks,
          onlyExplicitManualChunks: true,
        },
      },
    },
  };
});
