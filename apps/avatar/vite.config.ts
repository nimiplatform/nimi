import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {
  CUBISM_WEB_FRAMEWORK_CACHE_ROOT,
  ensureCubismFrameworkCache,
} from './scripts/cubism-web-sdk-cache.js';

const AVATAR_RENDERER_ENV_KEYS = Object.freeze([
  'VITE_AVATAR_DRIVER',
  'VITE_AVATAR_MOCK_SCENARIO',
  'VITE_NIMI_SHELL_MODE',
] as const);

export default defineConfig(({ mode }) => {
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));
  const sdkVNextDist = path.resolve(__dirname, '../../sdks/typescript/dist');
  const loadedEnv = { ...process.env, ...loadEnv(mode, workspaceRoot, '') };
  for (const key of Object.keys(loadedEnv)) {
    if (AVATAR_RENDERER_ENV_KEYS.some((allowed) => key.startsWith(allowed))
      && !AVATAR_RENDERER_ENV_KEYS.includes(key as typeof AVATAR_RENDERER_ENV_KEYS[number])) {
      throw new Error(`Avatar renderer env key is outside the explicit allowlist: ${key}`);
    }
  }

  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    base: './',
    envDir: workspaceRoot,
    envPrefix: [...AVATAR_RENDERER_ENV_KEYS],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('nimi-avatar'),
    },
    publicDir: path.resolve(__dirname, 'src/shell/renderer/public'),
    resolve: {
      dedupe: [
        'react',
        'react-dom',
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
        { find: '@framework', replacement: CUBISM_WEB_FRAMEWORK_CACHE_ROOT },
        { find: '@live2d', replacement: path.resolve(__dirname, 'src/shell/renderer/live2d') },
        { find: '@mock', replacement: path.resolve(__dirname, 'src/shell/renderer/mock') },
        { find: '@driver', replacement: path.resolve(__dirname, 'src/shell/renderer/driver') },
        { find: '@nimiplatform/sdk/runtime/generated', replacement: path.join(sdkVNextDist, 'runtime/generated.js') },
        { find: '@nimiplatform/sdk/runtime/wire-types', replacement: path.join(sdkVNextDist, 'runtime/wire-types/index.js') },
        { find: '@nimiplatform/sdk/runtime/host', replacement: path.join(sdkVNextDist, 'runtime/host.js') },
        { find: '@nimiplatform/sdk/runtime', replacement: path.join(sdkVNextDist, 'runtime/index.js') },
        { find: '@nimiplatform/sdk/realm/generated', replacement: path.join(sdkVNextDist, 'realm/generated.js') },
        { find: '@nimiplatform/sdk/realm', replacement: path.join(sdkVNextDist, 'realm/index.js') },
        { find: '@nimiplatform/sdk/app', replacement: path.join(sdkVNextDist, 'core/app/index.js') },
        { find: '@nimiplatform/sdk/types', replacement: path.join(sdkVNextDist, 'types/index.js') },
        { find: '@nimiplatform/sdk/contracts', replacement: path.join(sdkVNextDist, 'core/contracts/index.js') },
        { find: '@nimiplatform/sdk/ai', replacement: path.join(sdkVNextDist, 'core/ai/index.js') },
        { find: '@nimiplatform/sdk/agent', replacement: path.join(sdkVNextDist, 'core/agent/index.js') },
        { find: '@nimiplatform/sdk/testing', replacement: path.join(sdkVNextDist, 'core/testing/index.js') },
        { find: '@nimiplatform/sdk/features/conversation', replacement: path.join(sdkVNextDist, 'features/conversation/index.js') },
        { find: '@nimiplatform/sdk/features/knowledge-context', replacement: path.join(sdkVNextDist, 'features/knowledge-context/index.js') },
        { find: '@nimiplatform/sdk/features/memory-context', replacement: path.join(sdkVNextDist, 'features/memory-context/index.js') },
        { find: '@nimiplatform/sdk/features/generation', replacement: path.join(sdkVNextDist, 'features/generation/index.js') },
        { find: '@nimiplatform/sdk/features/evaluation', replacement: path.join(sdkVNextDist, 'features/evaluation/index.js') },
        { find: '@nimiplatform/sdk/features/toolkits', replacement: path.join(sdkVNextDist, 'features/toolkits/index.js') },
        { find: '@nimiplatform/sdk', replacement: path.join(sdkVNextDist, 'index.js') },
        { find: '@nimiplatform/kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src/index.ts') },
        { find: '@nimiplatform/kit/shell/capabilities', replacement: path.resolve(__dirname, '../../kit/shell/capabilities/src') },
        { find: '@nimiplatform/kit/shell/renderer/bridge', replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bridge/index.ts') },
        { find: '@nimiplatform/kit/features/avatar', replacement: path.resolve(__dirname, '../../kit/features/avatar/src') },
        { find: '@nimiplatform/kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
        { find: '@nimiplatform/kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
        { find: '@nimiplatform/kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
      ],
    },
    plugins: [
      {
        name: 'nimi-avatar-cubism-framework-cache',
        async configResolved() {
          await ensureCubismFrameworkCache();
        },
      },
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1427,
      strictPort: true,
      fs: {
        allow: [workspaceRoot, path.resolve(__dirname)],
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/shell/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');

            if (normalizedId.includes('/sdks/typescript/dist/core-generated/')) {
              return 'sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdks/typescript/dist/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/kit/ui/src/')) {
              return 'vendor-platform';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
