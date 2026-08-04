import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createWebPublicEnvDefines, resolveWebPublicEnv } from './public-env.js';

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

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function isNodePackage(normalizedId: string, packageName: string): boolean {
  return (
    normalizedId.includes(`/node_modules/.pnpm/${packageName}@`)
    || normalizedId.includes(`/node_modules/${packageName}/`)
  );
}

function isReactCoreVendor(normalizedId: string): boolean {
  return [
    'react',
    'react-dom',
    'scheduler',
    'use-sync-external-store',
  ].some((packageName) => isNodePackage(normalizedId, packageName));
}

export default defineConfig(({ mode }) => {
  loadWebBuildEnvFiles();
  const env = loadEnv(mode, __dirname, '');
  const realmProxyTarget = resolveRealmProxyTarget(env);
  const realtimeProxyTarget = resolveRealtimeProxyTarget(env, realmProxyTarget);
  const publicEnv = resolveWebPublicEnv({
    source: { ...process.env, ...env },
    realmProxyTarget,
    mode,
  });
  const sdkVNextDist = path.resolve(__dirname, '../../sdks/typescript/dist');
  return {
    plugins: [react(), tailwindcss()],
    envPrefix: [],
    define: {
      ...createWebPublicEnvDefines(publicEnv),
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
          find: '@renderer/features/runtime-config/runtime-config-panel-view',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-config-panel.web.tsx'),
        },
        {
          find: /^@renderer\/bridge$/,
          replacement: path.resolve(__dirname, 'src/desktop-adapter/bridge.web.ts'),
        },
        // Exact Desktop package exports bind Web to the same canonical factory,
        // production host, production bindings, and style entry as native Desktop.
        {
          find: '@nimiplatform/desktop/renderer/factory',
          replacement: path.resolve(__dirname, '../desktop/src/shell/renderer/renderer/factory.tsx'),
        },
        {
          find: '@nimiplatform/desktop/renderer/production-bindings',
          replacement: path.resolve(__dirname, '../desktop/src/shell/renderer/renderer/production-bindings.ts'),
        },
        {
          find: '@nimiplatform/desktop/renderer/production-host',
          replacement: path.resolve(__dirname, '../desktop/src/shell/renderer/renderer/production-host.ts'),
        },
        {
          find: '@nimiplatform/desktop/renderer/styles',
          replacement: path.resolve(__dirname, '../desktop/src/shell/renderer/styles.css'),
        },
        // Desktop public-for-web boundary retained for non-renderer projections.
        {
          find: '@desktop-public',
          replacement: path.resolve(__dirname, '../desktop/src/public-web'),
        },
        // Wide aliases kept for App.tsx transitive resolution only.
        // Web source files must not add new direct @renderer/* or @runtime/*
        // imports — use @desktop-public/* instead.
        {
          find: '@runtime',
          replacement: path.resolve(__dirname, '../desktop/src/runtime'),
        },
        {
          find: '@renderer/features/auth/desktop-auth-adapter.js',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/web-auth-adapter.ts'),
        },
        {
          find: '@renderer/features/settings/profile-oauth-platform.js',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/profile-oauth-platform.web.ts'),
        },
        {
          find: '@renderer',
          replacement: path.resolve(__dirname, '../desktop/src/shell/renderer'),
        },
        {
          find: '@nimiplatform/sdk/runtime/generated',
          replacement: path.join(sdkVNextDist, 'runtime/generated.js'),
        },
        {
          find: '@nimiplatform/sdk/runtime/wire-types',
          replacement: path.join(sdkVNextDist, 'runtime/wire-types/index.js'),
        },
        {
          find: '@nimiplatform/sdk/realm/generated',
          replacement: path.join(sdkVNextDist, 'realm/generated.js'),
        },
        {
          find: '@nimiplatform/sdk/runtime',
          replacement: path.join(sdkVNextDist, 'runtime/index.js'),
        },
        {
          find: '@nimiplatform/sdk/realm',
          replacement: path.join(sdkVNextDist, 'realm/index.js'),
        },
        {
          find: '@nimiplatform/sdk/app',
          replacement: path.join(sdkVNextDist, 'core/app/index.js'),
        },
        {
          find: '@nimiplatform/sdk/types',
          replacement: path.join(sdkVNextDist, 'types/index.js'),
        },
        {
          find: '@nimiplatform/sdk/contracts',
          replacement: path.join(sdkVNextDist, 'core/contracts/index.js'),
        },
        {
          find: '@nimiplatform/sdk/ai',
          replacement: path.join(sdkVNextDist, 'core/ai/index.js'),
        },
        {
          find: '@nimiplatform/sdk/agent',
          replacement: path.join(sdkVNextDist, 'core/agent/index.js'),
        },
        {
          find: '@nimiplatform/sdk/testing',
          replacement: path.join(sdkVNextDist, 'core/testing/index.js'),
        },
        {
          find: '@nimiplatform/sdk/features/conversation',
          replacement: path.join(sdkVNextDist, 'features/conversation/index.js'),
        },
        {
          find: '@nimiplatform/sdk/features/knowledge-context',
          replacement: path.join(sdkVNextDist, 'features/knowledge-context/index.js'),
        },
        {
          find: '@nimiplatform/sdk/features/memory-context',
          replacement: path.join(sdkVNextDist, 'features/memory-context/index.js'),
        },
        {
          find: '@nimiplatform/sdk/features/generation',
          replacement: path.join(sdkVNextDist, 'features/generation/index.js'),
        },
        {
          find: '@nimiplatform/sdk/features/evaluation',
          replacement: path.join(sdkVNextDist, 'features/evaluation/index.js'),
        },
        {
          find: '@nimiplatform/sdk/features/toolkits',
          replacement: path.join(sdkVNextDist, 'features/toolkits/index.js'),
        },
        {
          find: '@nimiplatform/sdk',
          replacement: path.join(sdkVNextDist, 'index.js'),
        },
        {
          find: '@nimiplatform/kit/core',
          replacement: path.resolve(__dirname, '../../kit/core/src'),
        },
        {
          find: '@nimiplatform/kit/ui',
          replacement: path.resolve(__dirname, '../../kit/ui/src'),
        },
        {
          find: '@nimiplatform/kit/auth',
          replacement: path.resolve(__dirname, '../../kit/auth/src'),
        },
        {
          find: /^@nimiplatform\/kit\/telemetry$/,
          replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts'),
        },
        {
          find: /^@nimiplatform\/kit\/telemetry\/error-boundary$/,
          replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts'),
        },
        {
          find: '@nimiplatform/kit/shell/capabilities',
          replacement: path.resolve(__dirname, '../../kit/shell/capabilities/src'),
        },
        {
          find: '@nimiplatform/kit/shell/renderer/bridge',
          replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bridge'),
        },
        {
          find: '@nimiplatform/kit/shell/renderer/bootstrap',
          replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bootstrap'),
        },
        {
          find: '@nimiplatform/kit/shell/renderer/host',
          replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/host'),
        },
        {
          find: '@nimiplatform/kit/features/avatar',
          replacement: path.resolve(__dirname, '../../kit/features/avatar/src'),
        },
        {
          find: '@nimiplatform/kit/features/chat',
          replacement: path.resolve(__dirname, '../../kit/features/chat/src'),
        },
        {
          find: '@nimiplatform/kit/features/commerce',
          replacement: path.resolve(__dirname, '../../kit/features/commerce/src'),
        },
        {
          find: '@nimiplatform/kit/features/generation',
          replacement: path.resolve(__dirname, '../../kit/features/generation/src'),
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
      modulePreload: false,
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
            if (normalizedId.includes('vite/preload-helper')) {
              return 'vite-preload';
            }
            if (normalizedId.includes('/kit/ui/src/')) {
              return 'vendor-kit-ui';
            }
            if (normalizedId.includes('/kit/features/chat/src/')) {
              return 'vendor-kit-chat';
            }
            if (normalizedId.includes('/kit/features/avatar/src/')) {
              return 'vendor-kit-avatar';
            }
            if (normalizedId.includes('/kit/features/commerce/src/')) {
              return 'vendor-kit-commerce';
            }
            if (normalizedId.includes('/kit/auth/src/')) {
              return 'vendor-kit-auth';
            }
            if (normalizedId.includes('/kit/shell/renderer/src/bridge/')) {
              return 'vendor-kit-shell-bridge';
            }
            if (normalizedId.includes('/kit/telemetry/src/')) {
              return 'vendor-kit-telemetry';
            }
            if (normalizedId.includes('/kit/core/src/')) {
              return 'vendor-kit-core';
            }
            if (normalizedId.includes('/apps/desktop/src/shell/renderer/features/chat/')) {
              if (
                normalizedId.includes('/chat-agent-runtime')
                || normalizedId.includes('/chat-agent-orchestration')
                || normalizedId.includes('/chat-agent-continuity')
                || normalizedId.includes('/chat-agent-turn-plan')
                || normalizedId.includes('/chat-agent-voice-workflow')
                || normalizedId.includes('/chat-agent-voice-workflow-tracker')
                || normalizedId.includes('/chat-agent-voice-capture')
                || normalizedId.includes('/chat-agent-user-projection')
              ) {
                return 'chat-agent-engine';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-avatar-',
                '/chat-agent-anchored-avatar-stage',
              ])) {
                return 'chat-agent-avatar';
              }
              if (normalizedId.includes('/chat-agent-debug-metadata')) {
                return 'chat-agent-debug-metadata';
              }
              if (matchesAny(normalizedId, [
                '/chat-shared-runtime-stream-ui',
                '/chat-stream-',
              ])) {
                return 'chat-stream-ui';
              }
              if (matchesAny(normalizedId, [
                '/chat-human-canonical-composer-profile',
              ])) {
                return 'chat-composer-profile';
              }
              if (matchesAny(normalizedId, [
                '/chat-group-composer',
              ])) {
                return 'chat-group-composer';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-canonical-composer',
                '/chat-composer-',
              ])) {
                return 'chat-composer-ui';
              }
              if (
                normalizedId.includes('/chat-human-canonical-components')
              ) {
                return 'chat-human-ui';
              }
              if (normalizedId.includes('/chat-human-')) {
                return 'chat-human-core';
              }
              if (
                normalizedId.includes('/chat-shared-settings-panel')
                || normalizedId.includes('/chat-settings-storage')
                || normalizedId.includes('/chat-shared-thinking')
              ) {
                return 'chat-settings';
              }
              if (matchesAny(normalizedId, [
                '/chat-settings-',
                '/chat-shared-settings-panel',
              ])) {
                return 'chat-settings-ui';
              }
              if (normalizedId.includes('/chat-nimi-')) {
                return 'chat-nimi-core';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-shell-presentation',
                '/chat-agent-mode-content',
                '/chat-agent-scene-background',
              ])) {
                return 'chat-agent-surface';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-shell-adapter',
                '/chat-agent-session-hydration',
                '/runtime-agent-inspect',
                '/chat-shared-floating-menu',
              ])) {
                return 'chat-agent-surface';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-behavior',
                '/chat-agent-voice-playback',
              ])) {
                return 'desktop-runtime-shell-core';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-shell-host-actions',
                '/chat-agent-shell-host-flow',
                '/chat-agent-shell-host-interaction',
                '/chat-agent-shell-projection-refresh',
                '/chat-agent-shell-submit',
                '/chat-agent-timeouts',
              ])) {
                return 'chat-agent-host-actions';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-shell-core',
                '/chat-agent-shell-lifecycle',
                '/chat-agent-shell-visible-state',
                '/chat-agent-shell-footer-state',
                '/chat-agent-shell-presentation-status',
                '/chat-agent-thread-model',
              ])) {
                return 'chat-agent-shell-state';
              }
              if (normalizedId.includes('/chat-agent-')) {
                return 'chat-agent-shell';
              }
            }
            if (normalizedId.includes('/sdks/typescript/dist/core-generated/')) {
              if (normalizedId.includes('/sdks/typescript/dist/core-generated/google/')) {
                return 'vendor-sdk-runtime-google';
              }
              if (normalizedId.includes('/sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/ai')) {
                return 'vendor-sdk-runtime-ai-generated';
              }
              if (normalizedId.includes('/sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/local_runtime')) {
                return 'vendor-sdk-runtime-local-generated';
              }
              if (normalizedId.includes('/sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/connector')) {
                return 'vendor-sdk-runtime-connector-generated';
              }
              if (normalizedId.includes('/sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/workflow')) {
                return 'vendor-sdk-runtime-workflow-generated';
              }
              if (normalizedId.includes('/sdks/typescript/dist/core-generated/runtime-protobuf/runtime/v1/model')) {
                return 'vendor-sdk-runtime-model-generated';
              }
              if (normalizedId.includes('/sdks/typescript/dist/core-generated/runtime-protobuf/runtime/')) {
                return 'vendor-sdk-runtime-generated';
              }
              return 'vendor-sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdks/typescript/dist/')) {
              return 'vendor-sdk-client';
            }
            if (normalizedId.includes('/apps/desktop/src/runtime/local-runtime/')) {
              return 'desktop-runtime-shell-core';
            }
            if (normalizedId.includes('/apps/desktop/src/runtime/llm-adapter/')) {
              return 'desktop-runtime-shell-core';
            }
            if (
              normalizedId.includes('/apps/desktop/src/shell/renderer/bridge/runtime-bridge/')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge/runtime-bridge.ts')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/bridge.ts')
            ) {
              return 'desktop-runtime-shell-core';
            }
            if (
              normalizedId.includes('/apps/desktop/src/shell/renderer/locales/en/')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/locales/en.json')
            ) {
              return 'vendor-shell-locale-en';
            }
            if (
              normalizedId.includes('/apps/desktop/src/shell/renderer/locales/zh/')
              || normalizedId.endsWith('/apps/desktop/src/shell/renderer/locales/zh.json')
            ) {
              return 'vendor-shell-locale-zh';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            if (isReactCoreVendor(normalizedId)) {
              return 'vendor-react';
            }
            if (
              isNodePackage(normalizedId, 'react-router')
              || isNodePackage(normalizedId, '@remix-run/router')
            ) {
              return 'vendor-router';
            }
            if (
              isNodePackage(normalizedId, '@tanstack/react-query')
              || isNodePackage(normalizedId, '@tanstack/query-core')
            ) {
              return 'vendor-query';
            }
            if (
              isNodePackage(normalizedId, 'i18next')
              || isNodePackage(normalizedId, 'react-i18next')
            ) {
              return 'vendor-i18n';
            }
            if (
              normalizedId.includes('/@nimiplatform/sdk')
              || normalizedId.includes('/@nimiplatform/kit/auth/')
              || isNodePackage(normalizedId, 'openapi-fetch')
            ) {
              return 'vendor-platform';
            }
            if (normalizedId.includes('/ai/') || normalizedId.includes('/@ai-sdk/')) {
              return 'vendor-ai';
            }
            if (
              normalizedId.includes('/three/examples/')
              || normalizedId.includes('/three/addons/')
            ) {
              return 'vendor-three-extras';
            }
            if (
              isNodePackage(normalizedId, 'three')
              || isNodePackage(normalizedId, 'simplex-noise')
            ) {
              return 'vendor-three-core';
            }
            if (
              normalizedId.includes('/@react-three/')
              || isNodePackage(normalizedId, 'postprocessing')
              || isNodePackage(normalizedId, 'three-stdlib')
            ) {
              return 'vendor-three-react';
            }
            if (
              isNodePackage(normalizedId, 'maath')
              || isNodePackage(normalizedId, '@monogrid/gainmap-js')
              || isNodePackage(normalizedId, 'camera-controls')
              || isNodePackage(normalizedId, 'meshline')
              || isNodePackage(normalizedId, 'troika-three-text')
              || isNodePackage(normalizedId, 'troika-three-utils')
              || isNodePackage(normalizedId, 'troika-worker-utils')
              || isNodePackage(normalizedId, 'webgl-sdf-generator')
              || isNodePackage(normalizedId, 'suspend-react')
              || isNodePackage(normalizedId, 'its-fine')
              || isNodePackage(normalizedId, 'react-use-measure')
              || isNodePackage(normalizedId, 'fflate')
              || isNodePackage(normalizedId, 'bidi-js')
            ) {
              return 'vendor-three-support';
            }
            if (
              isNodePackage(normalizedId, 'socket.io-client')
              || isNodePackage(normalizedId, 'engine.io-client')
              || isNodePackage(normalizedId, 'socket.io-parser')
              || isNodePackage(normalizedId, 'engine.io-parser')
              || isNodePackage(normalizedId, '@socket.io/component-emitter')
            ) {
              return 'vendor-socket';
            }
            if (
              isNodePackage(normalizedId, '@protobuf-ts/runtime')
              || isNodePackage(normalizedId, '@protobuf-ts/runtime-rpc')
            ) {
              return 'vendor-protobuf';
            }
            if (
              isNodePackage(normalizedId, 'ajv')
              || isNodePackage(normalizedId, 'zod')
              || isNodePackage(normalizedId, 'yaml')
            ) {
              return 'vendor-data';
            }
            if (isNodePackage(normalizedId, '@tauri-apps/api')) {
              return 'vendor-tauri';
            }
            if (
              isNodePackage(normalizedId, 'zustand')
              || isNodePackage(normalizedId, 'use-sync-external-store')
            ) {
              return 'vendor-state';
            }
            if (
              isNodePackage(normalizedId, 'lodash')
              || isNodePackage(normalizedId, 'lodash-es')
            ) {
              return 'vendor-lodash';
            }
            if (
              isNodePackage(normalizedId, 'unified')
              || isNodePackage(normalizedId, 'vfile')
              || isNodePackage(normalizedId, 'vfile-message')
              || isNodePackage(normalizedId, 'bail')
              || isNodePackage(normalizedId, '@ungap/structured-clone')
              || isNodePackage(normalizedId, 'style-to-js')
              || isNodePackage(normalizedId, 'style-to-object')
              || isNodePackage(normalizedId, 'inline-style-parser')
              || isNodePackage(normalizedId, 'devlop')
              || isNodePackage(normalizedId, 'estree-util-is-identifier-name')
              || isNodePackage(normalizedId, 'html-url-attributes')
              || isNodePackage(normalizedId, 'decode-named-character-reference')
              || isNodePackage(normalizedId, 'extend')
              || isNodePackage(normalizedId, 'is-plain-obj')
              || isNodePackage(normalizedId, 'trough')
              || isNodePackage(normalizedId, 'react-markdown')
              || isNodePackage(normalizedId, 'escape-string-regexp')
              || isNodePackage(normalizedId, 'longest-streak')
              || normalizedId.includes('/node_modules/.pnpm/mdast-')
              || normalizedId.includes('/node_modules/.pnpm/micromark')
              || normalizedId.includes('/node_modules/.pnpm/hast-')
              || normalizedId.includes('/node_modules/.pnpm/unist-')
              || normalizedId.includes('/node_modules/.pnpm/remark-')
              || normalizedId.includes('/node_modules/.pnpm/rehype-')
              || normalizedId.includes('/node_modules/.pnpm/property-information')
              || normalizedId.includes('/node_modules/.pnpm/space-separated-tokens')
              || normalizedId.includes('/node_modules/.pnpm/comma-separated-tokens')
              || normalizedId.includes('/node_modules/.pnpm/trim-lines')
              || normalizedId.includes('/node_modules/.pnpm/ccount')
              || normalizedId.includes('/node_modules/.pnpm/character-entities')
              || normalizedId.includes('/node_modules/.pnpm/markdown-')
            ) {
              return 'vendor-markdown';
            }
            if (
              isNodePackage(normalizedId, 'clsx')
              || isNodePackage(normalizedId, 'tailwind-merge')
              || isNodePackage(normalizedId, 'class-variance-authority')
              || isNodePackage(normalizedId, '@babel/runtime')
              || isNodePackage(normalizedId, '@radix-ui/primitive')
              || isNodePackage(normalizedId, '@radix-ui/number')
            ) {
              return 'vendor-shared-ui-utils';
            }
            if (
              isNodePackage(normalizedId, 'lucide-react')
              || isNodePackage(normalizedId, '@radix-ui/react-arrow')
              || isNodePackage(normalizedId, '@radix-ui/react-avatar')
              || isNodePackage(normalizedId, '@radix-ui/react-collection')
              || isNodePackage(normalizedId, '@radix-ui/react-context')
              || isNodePackage(normalizedId, '@radix-ui/react-dialog')
              || isNodePackage(normalizedId, '@radix-ui/react-direction')
              || isNodePackage(normalizedId, '@radix-ui/react-focus-guards')
              || isNodePackage(normalizedId, '@radix-ui/react-id')
              || isNodePackage(normalizedId, '@radix-ui/react-popper')
              || isNodePackage(normalizedId, '@radix-ui/react-popover')
              || isNodePackage(normalizedId, '@radix-ui/react-scroll-area')
              || isNodePackage(normalizedId, '@radix-ui/react-select')
              || isNodePackage(normalizedId, '@radix-ui/react-slot')
              || isNodePackage(normalizedId, '@radix-ui/react-switch')
              || isNodePackage(normalizedId, '@radix-ui/react-compose-refs')
              || isNodePackage(normalizedId, '@radix-ui/react-primitive')
              || isNodePackage(normalizedId, '@radix-ui/react-use-callback-ref')
              || isNodePackage(normalizedId, '@radix-ui/react-use-controllable-state')
              || isNodePackage(normalizedId, '@radix-ui/react-use-effect-event')
              || isNodePackage(normalizedId, '@radix-ui/react-use-escape-keydown')
              || isNodePackage(normalizedId, '@radix-ui/react-use-is-hydrated')
              || isNodePackage(normalizedId, '@radix-ui/react-use-layout-effect')
              || isNodePackage(normalizedId, '@radix-ui/react-use-previous')
              || isNodePackage(normalizedId, '@radix-ui/react-use-size')
              || isNodePackage(normalizedId, '@radix-ui/react-dismissable-layer')
              || isNodePackage(normalizedId, '@radix-ui/react-portal')
              || isNodePackage(normalizedId, '@radix-ui/react-presence')
              || isNodePackage(normalizedId, '@radix-ui/react-focus-scope')
              || isNodePackage(normalizedId, '@radix-ui/react-visually-hidden')
              || isNodePackage(normalizedId, '@floating-ui/react-dom')
              || isNodePackage(normalizedId, '@floating-ui/react-dom-interactions')
              || isNodePackage(normalizedId, '@floating-ui/core')
              || isNodePackage(normalizedId, '@floating-ui/dom')
              || isNodePackage(normalizedId, '@floating-ui/utils')
              || isNodePackage(normalizedId, 'react-remove-scroll')
              || isNodePackage(normalizedId, 'react-remove-scroll-bar')
              || isNodePackage(normalizedId, 'react-style-singleton')
              || isNodePackage(normalizedId, 'use-callback-ref')
              || isNodePackage(normalizedId, 'use-sidecar')
              || isNodePackage(normalizedId, 'aria-hidden')
              || isNodePackage(normalizedId, 'get-nonce')
              || isNodePackage(normalizedId, 'tslib')
            ) {
              return 'vendor-react-ui';
            }
            if (
              isNodePackage(normalizedId, '@tanstack/virtual-core')
              || isNodePackage(normalizedId, '@tanstack/react-virtual')
            ) {
              return 'vendor-virtual';
            }
            return 'vendor-misc';
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
  };
});
