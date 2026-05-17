import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function isNodePackage(normalizedId: string, packageName: string): boolean {
  return (
    normalizedId.includes(`/node_modules/.pnpm/${packageName}@`)
    || normalizedId.includes(`/node_modules/${packageName}/`)
  );
}

export default defineConfig(() => {
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));

  return {
    root: path.resolve(__dirname, 'src/shell/renderer'),
    envDir: workspaceRoot,
    envPrefix: ['VITE_', 'NIMI_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
      'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('parentos'),
    },
    publicDir: false as const,
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react-i18next',
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
        { find: 'scheduler', replacement: require.resolve('scheduler') },
        { find: '@tauri-apps/api/core', replacement: path.resolve(__dirname, 'node_modules/@tauri-apps/api/core.js') },
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
        { find: '@engine', replacement: path.resolve(__dirname, 'src/shell/renderer/engine') },
        { find: '@nimiplatform/sdk/runtime/browser', replacement: path.resolve(__dirname, '../../sdk/src/runtime/browser.ts') },
        { find: '@nimiplatform/sdk/runtime', replacement: path.resolve(__dirname, '../../sdk/src/runtime/browser.ts') },
        { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdk/src/realm/index.ts') },
        { find: '@nimiplatform/sdk/types', replacement: path.resolve(__dirname, '../../sdk/src/types/index.ts') },
        { find: '@nimiplatform/sdk/ai-provider', replacement: path.resolve(__dirname, '../../sdk/src/ai-provider/index.ts') },
        { find: '@nimiplatform/sdk/scope', replacement: path.resolve(__dirname, '../../sdk/src/scope/index.ts') },
        { find: '@nimiplatform/sdk/mod/lifecycle', replacement: path.resolve(__dirname, '../../sdk/src/mod/lifecycle.ts') },
        { find: '@nimiplatform/sdk/mod/shell', replacement: path.resolve(__dirname, '../../sdk/src/mod/shell.ts') },
        { find: '@nimiplatform/sdk/mod/storage', replacement: path.resolve(__dirname, '../../sdk/src/mod/storage/index.ts') },
        { find: '@nimiplatform/sdk/mod', replacement: path.resolve(__dirname, '../../sdk/src/mod/index.ts') },
        { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/src/index.ts') },
        { find: '@nimiplatform/nimi-kit/features/model-picker', replacement: path.resolve(__dirname, '../../kit/features/model-picker/src') },
        { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
        { find: '@nimiplatform/nimi-kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src') },
        { find: '@nimiplatform/nimi-kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
        { find: '@nimiplatform/nimi-kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
        { find: '@nimiplatform/nimi-kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
      ],
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    optimizeDeps: {
      // Lazy-imported by report-export.ts for PDF/PNG capture. Vite's
      // entry scanner doesn't follow dynamic imports, so the dep is
      // invisible at dev-server start without this hint and the first
      // export attempt fails with "Failed to resolve import".
      include: ['html-to-image', 'jspdf'],
    },
    server: {
      host: '127.0.0.1',
      port: 1426,
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
                return 'sdk-runtime-google-generated';
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
                return 'sdk-runtime-core-generated';
              }
              return 'sdk-runtime-support-generated';
            }
            if (normalizedId.includes('/sdk/src/realm/generated/')) {
              return 'sdk-realm-generated';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/kit/auth/src/')) {
              return 'sdk-client';
            }
            if (normalizedId.includes('/kit/ui/src/') || normalizedId.includes('/kit/features/')) {
              return 'vendor-platform';
            }
            if (normalizedId.includes('/features/profile/generated/lms-slices/')) {
              const fileName = path.basename(normalizedId, '.json').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
              return `parentos-growth-data-${fileName}`;
            }
            if (normalizedId.includes('/engine/growth-percentile-band')) {
              return 'parentos-growth-percentile-engine';
            }
            if (normalizedId.includes('/knowledge-base/gen/reminder-rules.gen')) {
              return 'parentos-knowledge-reminders';
            }
            if (normalizedId.includes('/knowledge-base/gen/health-record.gen')) {
              return 'parentos-knowledge-health-records';
            }
            if (normalizedId.includes('/knowledge-base/gen/observation-framework.gen')) {
              return 'parentos-knowledge-observation';
            }
            if (normalizedId.includes('/knowledge-base/gen/growth-standards.gen')) {
              return 'parentos-knowledge-growth';
            }
            if (normalizedId.includes('/knowledge-base/gen/milestone-catalog.gen')) {
              return 'parentos-knowledge-milestones';
            }
            if (normalizedId.includes('/knowledge-base/gen/sensitive-periods.gen')) {
              return 'parentos-knowledge-sensitive-periods';
            }
            if (normalizedId.includes('/knowledge-base/gen/knowledge-source-readiness.gen')) {
              return 'parentos-knowledge-readiness';
            }
            if (normalizedId.includes('/knowledge-base/gen/nurture-modes.gen')) {
              return 'parentos-knowledge-nurture-modes';
            }
            if (normalizedId.includes('/bridge/')) {
              return 'runtime-bridge';
            }
            if (normalizedId.includes('/engine/')) {
              if (matchesAny(normalizedId, [
                '/reminder-engine',
                '/reminder-actions',
                '/reminder-freq-overrides',
                '/reminder-state-mapper',
              ])) {
                return 'parentos-reminder-engine';
              }
              if (matchesAny(normalizedId, [
                '/reminder-progression',
                '/reminder-progression-evidence',
              ])) {
                return 'parentos-reminder-progression';
              }
              if (matchesAny(normalizedId, [
                '/health-record-domain',
                '/observation-matcher',
                '/smart-alerts',
              ])) {
                return 'parentos-health-engine';
              }
              if (normalizedId.includes('/ai-safety-filter')) {
                return 'parentos-ai-safety-engine';
              }
              return 'parentos-domain-engine';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            if (
              isNodePackage(normalizedId, 'react')
              || isNodePackage(normalizedId, 'react-dom')
              || isNodePackage(normalizedId, 'scheduler')
              || isNodePackage(normalizedId, 'use-sync-external-store')
            ) {
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
            if (isNodePackage(normalizedId, 'zustand')) {
              return 'vendor-state';
            }
            if (
              isNodePackage(normalizedId, 'recharts')
              || normalizedId.includes('/node_modules/.pnpm/d3-')
              || normalizedId.includes('/node_modules/d3-')
              || isNodePackage(normalizedId, 'react-smooth')
              || isNodePackage(normalizedId, 'recharts-scale')
              || isNodePackage(normalizedId, 'prop-types')
              || isNodePackage(normalizedId, 'react-is')
              || isNodePackage(normalizedId, 'eventemitter3')
              || isNodePackage(normalizedId, 'internmap')
              || isNodePackage(normalizedId, 'decimal.js-light')
              || isNodePackage(normalizedId, 'tiny-invariant')
              || isNodePackage(normalizedId, 'fast-equals')
            ) {
              return 'vendor-misc';
            }
            if (
              isNodePackage(normalizedId, 'i18next')
              || isNodePackage(normalizedId, 'react-i18next')
            ) {
              return 'vendor-i18n';
            }
            if (
              isNodePackage(normalizedId, '@protobuf-ts/runtime')
              || isNodePackage(normalizedId, '@protobuf-ts/runtime-rpc')
            ) {
              return 'vendor-protobuf';
            }
            if (isNodePackage(normalizedId, '@tauri-apps/api')) {
              return 'vendor-tauri';
            }
            if (isNodePackage(normalizedId, 'lodash')) {
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
              || isNodePackage(normalizedId, '@radix-ui/primitive')
              || isNodePackage(normalizedId, '@radix-ui/number')
              || isNodePackage(normalizedId, '@floating-ui/core')
              || isNodePackage(normalizedId, '@floating-ui/dom')
              || isNodePackage(normalizedId, '@floating-ui/utils')
              || isNodePackage(normalizedId, '@floating-ui/react-dom')
            ) {
              return 'vendor-shared-ui-utils';
            }
            if (
              isNodePackage(normalizedId, 'lucide-react')
              || isNodePackage(normalizedId, '@radix-ui/react-switch')
              || isNodePackage(normalizedId, '@radix-ui/react-slot')
              || isNodePackage(normalizedId, '@radix-ui/react-arrow')
              || isNodePackage(normalizedId, '@radix-ui/react-collection')
              || isNodePackage(normalizedId, '@radix-ui/react-compose-refs')
              || isNodePackage(normalizedId, '@radix-ui/react-context')
              || isNodePackage(normalizedId, '@radix-ui/react-dialog')
              || isNodePackage(normalizedId, '@radix-ui/react-direction')
              || isNodePackage(normalizedId, '@radix-ui/react-dismissable-layer')
              || isNodePackage(normalizedId, '@radix-ui/react-focus-guards')
              || isNodePackage(normalizedId, '@radix-ui/react-focus-scope')
              || isNodePackage(normalizedId, '@radix-ui/react-id')
              || isNodePackage(normalizedId, '@radix-ui/react-popper')
              || isNodePackage(normalizedId, '@radix-ui/react-portal')
              || isNodePackage(normalizedId, '@radix-ui/react-primitive')
              || isNodePackage(normalizedId, '@radix-ui/react-presence')
              || isNodePackage(normalizedId, '@radix-ui/react-scroll-area')
              || isNodePackage(normalizedId, '@radix-ui/react-select')
              || isNodePackage(normalizedId, '@radix-ui/react-tooltip')
              || isNodePackage(normalizedId, '@radix-ui/react-use-escape-keydown')
              || isNodePackage(normalizedId, '@radix-ui/react-use-callback-ref')
              || isNodePackage(normalizedId, '@radix-ui/react-use-controllable-state')
              || isNodePackage(normalizedId, '@radix-ui/react-use-effect-event')
              || isNodePackage(normalizedId, '@radix-ui/react-use-layout-effect')
              || isNodePackage(normalizedId, '@radix-ui/react-use-previous')
              || isNodePackage(normalizedId, '@radix-ui/react-use-size')
              || isNodePackage(normalizedId, '@radix-ui/react-visually-hidden')
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
              isNodePackage(normalizedId, 'three')
              || isNodePackage(normalizedId, 'simplex-noise')
            ) {
              return 'vendor-three';
            }
            if (isNodePackage(normalizedId, '@tanstack/virtual-core')) {
              return 'vendor-virtual';
            }
            if (isNodePackage(normalizedId, '@tanstack/react-virtual')) {
              return 'vendor-virtual';
            }
            if (isNodePackage(normalizedId, 'openapi-fetch')) {
              return 'sdk-client';
            }
            if (
              isNodePackage(normalizedId, 'html-to-image')
              || isNodePackage(normalizedId, 'jspdf')
            ) {
              return 'vendor-canvas-export';
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
