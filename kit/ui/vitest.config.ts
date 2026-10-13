import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

// Resolve the installed Kit dependency graph, never stale pnpm cache entries.
function kitPackageRoot(packageName: string): string {
  return fs.realpathSync(path.resolve(import.meta.dirname, '../node_modules', packageName));
}

export default defineConfig({
  plugins: [
    {
      name: 'nimi-kit-raw-html-fixtures',
      transform(code, id) {
        if (!id.endsWith('.html')) {
          return null;
        }
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: null,
        };
      },
    },
  ],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'scheduler',
      '@radix-ui/react-avatar',
      '@radix-ui/react-dialog',
      '@radix-ui/react-popover',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tooltip',
      'class-variance-authority',
      'clsx',
      'lucide-react',
      'tailwind-merge',
    ],
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(import.meta.dirname, '../../apps/desktop/node_modules/react/jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: path.resolve(import.meta.dirname, '../../apps/desktop/node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/server', replacement: path.resolve(import.meta.dirname, '../../apps/desktop/node_modules/react-dom/server.node.js') },
      { find: 'react-dom/client', replacement: path.resolve(import.meta.dirname, '../../apps/desktop/node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: path.resolve(import.meta.dirname, '../../apps/desktop/node_modules/react-dom/index.js') },
      { find: 'react', replacement: path.resolve(import.meta.dirname, '../../apps/desktop/node_modules/react/index.js') },
      { find: '@radix-ui/react-avatar', replacement: kitPackageRoot('@radix-ui/react-avatar') },
      { find: '@radix-ui/react-dialog', replacement: kitPackageRoot('@radix-ui/react-dialog') },
      { find: '@radix-ui/react-popover', replacement: kitPackageRoot('@radix-ui/react-popover') },
      { find: '@radix-ui/react-scroll-area', replacement: kitPackageRoot('@radix-ui/react-scroll-area') },
      { find: '@radix-ui/react-select', replacement: kitPackageRoot('@radix-ui/react-select') },
      { find: '@radix-ui/react-slot', replacement: kitPackageRoot('@radix-ui/react-slot') },
      { find: '@radix-ui/react-switch', replacement: kitPackageRoot('@radix-ui/react-switch') },
      { find: '@radix-ui/react-tooltip', replacement: kitPackageRoot('@radix-ui/react-tooltip') },
      { find: 'class-variance-authority', replacement: kitPackageRoot('class-variance-authority') },
      { find: 'clsx', replacement: kitPackageRoot('clsx') },
      { find: 'lucide-react', replacement: kitPackageRoot('lucide-react') },
      { find: 'tailwind-merge', replacement: kitPackageRoot('tailwind-merge') },
      { find: '@nimiplatform/sdk/features/conversation', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/features/conversation/index.ts') },
      { find: '@nimiplatform/sdk/features/generation', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/features/generation/index.ts') },
      { find: '@nimiplatform/sdk/runtime/generated', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/runtime/generated.ts') },
      { find: '@nimiplatform/sdk/runtime/host', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/runtime/host.ts') },
      { find: '@nimiplatform/sdk/runtime/wire-types', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/runtime/wire-types/index.ts') },
      { find: '@nimiplatform/sdk/realm/generated', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/realm/generated.ts') },
      { find: '@nimiplatform/sdk/contracts', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/core/contracts/index.ts') },
      { find: '@nimiplatform/sdk/runtime', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/runtime/index.ts') },
      { find: '@nimiplatform/sdk/realm', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/realm/index.ts') },
      { find: '@nimiplatform/sdk/types', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/types/index.ts') },
      { find: '@nimiplatform/sdk/app', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/core/app/index.ts') },
      { find: '@nimiplatform/sdk/ai', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/core/ai/index.ts') },
      { find: '@nimiplatform/sdk', replacement: path.resolve(import.meta.dirname, '../../sdks/typescript/index.ts') },
      { find: '@nimiplatform/kit/ui/a11y', replacement: path.resolve(import.meta.dirname, './src/a11y/index.ts') },
      { find: '@nimiplatform/kit/ui/app-chrome', replacement: path.resolve(import.meta.dirname, './src/app-chrome/index.ts') },
      { find: '@nimiplatform/kit/ui', replacement: path.resolve(import.meta.dirname, './src/index.ts') },
      { find: '@nimiplatform/kit/features/chat', replacement: path.resolve(import.meta.dirname, '../features/chat/src') },
      { find: '@nimiplatform/kit/features/generation', replacement: path.resolve(import.meta.dirname, '../features/generation/src') },
      { find: '@nimiplatform/kit/features/avatar', replacement: path.resolve(import.meta.dirname, '../features/avatar/src') },
      { find: '@nimiplatform/kit/features/model-config', replacement: path.resolve(import.meta.dirname, '../features/model-config/src') },
      { find: '@nimiplatform/kit/features/model-picker', replacement: path.resolve(import.meta.dirname, '../features/model-picker/src') },
      { find: '@nimiplatform/kit/auth', replacement: path.resolve(import.meta.dirname, '../auth/src/index.ts') },
      { find: '@nimiplatform/kit/core/shell-mode', replacement: path.resolve(import.meta.dirname, '../core/src/shell-mode.ts') },
      { find: '@nimiplatform/kit/core/navigation', replacement: path.resolve(import.meta.dirname, '../core/src/navigation.ts') },
      { find: '@nimiplatform/kit/core/app-commands', replacement: path.resolve(import.meta.dirname, '../core/src/app-commands.ts') },
      { find: '@nimiplatform/kit/core/oauth', replacement: path.resolve(import.meta.dirname, '../core/src/oauth') },
      { find: '@nimiplatform/kit/core/desktop-open', replacement: path.resolve(import.meta.dirname, '../core/src/desktop-open.ts') },
      { find: '@nimiplatform/kit/core/sdk-contract', replacement: path.resolve(import.meta.dirname, '../core/src/sdk-contract.ts') },
      { find: '@nimiplatform/kit/core/runtime-capabilities', replacement: path.resolve(import.meta.dirname, '../core/src/runtime-capabilities') },
      { find: '@nimiplatform/kit/telemetry', replacement: path.resolve(import.meta.dirname, '../telemetry/src/telemetry/index.ts') },
      { find: '@nimiplatform/kit/shell/capabilities', replacement: path.resolve(import.meta.dirname, '../shell/capabilities/src/index.ts') },
      { find: '@nimiplatform/kit/shell/renderer', replacement: path.resolve(import.meta.dirname, '../shell/renderer/src') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['**/test/**/*.test.ts', '**/test/**/*.test.tsx'],
    // The full Windows shard runs 140+ files concurrently. Content-admission
    // tests complete in well under a second in isolation, but can spend more
    // than Vitest's 5s default waiting for filesystem workers under shard
    // contention. Keep their assertions strict while bounding that scheduler
    // delay explicitly.
    testTimeout: process.platform === 'win32' ? 15_000 : 5_000,
  },
});
