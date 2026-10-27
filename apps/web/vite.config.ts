import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createWebPublicEnvDefines, resolveWebPublicEnv } from './public-env.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const repoRootNormalized = repoRoot.replaceAll('\\', '/');

function chunkName(id: string): string | undefined {
  const normalized = id.replaceAll('\\', '/');

  // Keep each App's authored locale copy in its own cacheable content chunk.
  // Combining all preview dictionaries makes the locale entry exceed the App
  // chunk budget as more previews are added. These remain non-vendor chunks.
  if (normalized.startsWith(`${repoRootNormalized}/apps/web/src/landing/content/app-preview-copy/`)) {
    const copy = /\/([^/]+)\.(en|zh)\.ts$/u.exec(normalized);
    if (copy) return `landing-copy-${copy[1]}-${copy[2]}`;
  }

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
  if (normalized.includes('/node_modules/hls.js/')) {
    return 'vendor-hls';
  }
  const isNimiSdk = normalized.startsWith(`${repoRootNormalized}/sdks/typescript/`)
    || normalized.includes('/node_modules/@nimiplatform/sdk/');
  if (isNimiSdk && /\/core-generated\/realm-(?:client|typed-client)\.js$/u.test(normalized)) {
    return 'vendor-nimi-sdk-realm';
  }
  if (
    normalized.includes('/node_modules/framer-motion/')
    || normalized.includes('/node_modules/motion-dom/')
    || normalized.includes('/node_modules/motion-utils/')
  ) {
    return 'vendor-motion';
  }
  if (
    normalized.includes('/node_modules/@radix-ui/')
    || normalized.includes('/node_modules/@floating-ui/')
  ) {
    return 'vendor-ui-primitives';
  }
  if (
    normalized.includes('/node_modules/@tanstack/react-virtual/')
    || normalized.includes('/node_modules/@tanstack/virtual-core/')
  ) {
    return 'vendor-virtualization';
  }
  if (/\/node_modules\/(?:react-markdown|remark-[^/]+|rehype-[^/]+|micromark(?:-[^/]+)?|mdast-util-[^/]+|hast-util-[^/]+|unist-util-[^/]+|unified|vfile(?:-[^/]+)?)\//u.test(normalized)) {
    return 'vendor-markdown';
  }
  if (
    normalized.includes('/node_modules/tailwind-merge/')
    || normalized.includes('/node_modules/clsx/')
    || normalized.includes('/node_modules/class-variance-authority/')
  ) {
    return 'vendor-styling';
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

  const isNimiKit =
    normalized.includes('/node_modules/@nimiplatform/kit/')
    || normalized.startsWith(`${repoRootNormalized}/kit/`);
  if (isNimiKit && normalized.includes('/features/agent-center/')) {
    return 'vendor-nimi-kit-agent-center';
  }

  // Other Kit modules chunk by their real import graph. A unified vendor-nimi-kit
  // chunk would collapse kit's internal lazy boundaries (e.g. the auth
  // particle background's dynamic three import) into static edges and force
  // every kit consumer to load unrelated heavy modules.
  return undefined;
}

function loadRootEnv(): void {
  if (typeof process.loadEnvFile !== 'function') return;
  const file = path.resolve(import.meta.dirname, '..', '..', '.env');
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
  const env = loadEnv(mode, import.meta.dirname, '');
  const realmProxyTarget = httpOrigin(env.NIMI_REALM_URL || process.env.NIMI_REALM_URL);
  const publicEnv = resolveWebPublicEnv({ source: { ...process.env, ...env }, realmProxyTarget, mode });
  const sdkDist = path.resolve(import.meta.dirname, '../../sdks/typescript/dist');
  return {
    plugins: [react({ exclude: [/\/node_modules\//, /\/src\/(?:shell\/renderer\/)?main\.tsx$/] }), tailwindcss()],
    envPrefix: [],
    define: createWebPublicEnvDefines(publicEnv),
    resolve: {
      dedupe: ['react', 'react-dom', 'i18next', 'react-i18next'],
      alias: [
        { find: /^@nimiplatform\/kit\/auth\/styles\.css$/, replacement: path.resolve(import.meta.dirname, '../../kit/auth/src/styles.css') },
        { find: /^@nimiplatform\/kit\/auth$/, replacement: path.resolve(import.meta.dirname, '../../kit/auth/src/index.ts') },
        { find: /^@nimiplatform\/kit\/core\/(.*)$/, replacement: path.resolve(import.meta.dirname, '../../kit/core/src/$1') },
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
      rolldownOptions: {
        treeshake: {
          // These barrels emit only re-exports. Web Auth and the static Chat
          // preview need no initialization from unused Runtime/native exports.
          // The closure test guards these exact entrypoints, not entire packages.
          moduleSideEffects: [{
            test: /[/\\]kit[/\\](?:core[/\\]src[/\\]sdk-contract\.ts|dist[/\\]features[/\\]chat[/\\]ui\.js)$/u,
            external: false,
            sideEffects: false,
          }],
        },
        input: {
          main: path.resolve(import.meta.dirname, 'index.html'),
          download: path.resolve(import.meta.dirname, 'download.html'),
          codeSigning: path.resolve(import.meta.dirname, 'code-signing.html'),
          blueyard: path.resolve(import.meta.dirname, 'blueyard.html'),
          terms: path.resolve(import.meta.dirname, 'terms.html'),
          privacy: path.resolve(import.meta.dirname, 'privacy.html'),
        },
        output: {
          strictExecutionOrder: true,
          codeSplitting: {
            includeDependenciesRecursively: false,
            groups: [{ name: chunkName }],
          },
        },
      },
    },
  };
});
