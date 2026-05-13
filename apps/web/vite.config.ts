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
          find: '@renderer/features/tester/world-tour-viewer-route',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/world-tour-viewer-route.web.tsx'),
        },
        {
          find: /^@renderer\/bridge$/,
          replacement: path.resolve(__dirname, 'src/desktop-adapter/bridge.web.ts'),
        },
        {
          find: '@renderer/features/chat/chat-agent-avatar-live2d-cubism-runtime-loader',
          replacement: path.resolve(__dirname, 'src/desktop-adapter/chat-agent-avatar-live2d-cubism-runtime-loader.web.ts'),
        },
        {
          find: /^@runtime\/mod$/,
          replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-mod.web.ts'),
        },
        // Desktop public-for-web boundary: web source files import from here
        // instead of reaching into desktop internals directly.
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
            if (normalizedId.includes('/kit/features/model-config/src/')) {
              return 'vendor-kit-model-config';
            }
            if (normalizedId.includes('/kit/features/model-picker/src/')) {
              return 'vendor-kit-model-picker';
            }
            if (normalizedId.includes('/kit/core/src/model-config/')) {
              return 'vendor-kit-model-config-core';
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
                '/chat-right-panel-character-rail',
                '/chat-agent-anchored-avatar-stage',
              ])) {
                return 'chat-agent-avatar';
              }
              if (matchesAny(normalizedId, [
                '/chat-agent-diagnostics',
                '/chat-agent-debug-metadata',
              ])) {
                return 'chat-agent-diagnostics';
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
                return 'chat-human-surface';
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
                return 'chat-human-surface';
              }
              if (normalizedId.includes('/chat-human-')) {
                return 'chat-human-surface';
              }
              if (
                normalizedId.includes('/conversation-capability')
                || normalizedId.includes('/conversation-submit-readiness')
                || normalizedId.includes('/capability-settings-shared')
                || normalizedId.includes('/chat-shared-settings-panel')
                || normalizedId.includes('/chat-settings-storage')
                || normalizedId.includes('/chat-shared-thinking')
                || normalizedId.includes('/chat-shared-execution-scheduling-guard')
              ) {
                return 'chat-capabilities';
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
                '/chat-agent-center-panel',
                '/chat-agent-center-avatar-debug-workbench',
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
                '/chat-agent-center-avatar-config',
                '/chat-agent-center-local-config',
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
              return 'desktop-runtime-shell-core';
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
              || normalizedId.includes('/@nimiplatform/nimi-kit/auth/')
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
