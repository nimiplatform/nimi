import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '../..');
const pnpmRoot = path.join(repoRoot, 'node_modules/.pnpm');

function pnpmPackageRoot(packageName: string): string {
  const packageDirectoryName = packageName.startsWith('@')
    ? packageName.replace('/', '+')
    : packageName;
  const match = fs.readdirSync(pnpmRoot)
    .filter((entry) => (
      entry.startsWith(`${packageDirectoryName}@`)
      || entry.startsWith(`${packageDirectoryName}_`)
    ))
    .sort()[0];
  if (!match) {
    throw new Error(`Missing pnpm package for ${packageName}`);
  }
  return path.join(pnpmRoot, match, 'node_modules', packageName);
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
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react/jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/server', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react-dom/server.node.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react-dom/index.js') },
      { find: 'react', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react/index.js') },
      { find: '@radix-ui/react-avatar', replacement: pnpmPackageRoot('@radix-ui/react-avatar') },
      { find: '@radix-ui/react-dialog', replacement: pnpmPackageRoot('@radix-ui/react-dialog') },
      { find: '@radix-ui/react-popover', replacement: pnpmPackageRoot('@radix-ui/react-popover') },
      { find: '@radix-ui/react-scroll-area', replacement: pnpmPackageRoot('@radix-ui/react-scroll-area') },
      { find: '@radix-ui/react-select', replacement: pnpmPackageRoot('@radix-ui/react-select') },
      { find: '@radix-ui/react-slot', replacement: pnpmPackageRoot('@radix-ui/react-slot') },
      { find: '@radix-ui/react-switch', replacement: pnpmPackageRoot('@radix-ui/react-switch') },
      { find: '@radix-ui/react-tooltip', replacement: pnpmPackageRoot('@radix-ui/react-tooltip') },
      { find: 'class-variance-authority', replacement: pnpmPackageRoot('class-variance-authority') },
      { find: 'clsx', replacement: pnpmPackageRoot('clsx') },
      { find: 'lucide-react', replacement: pnpmPackageRoot('lucide-react') },
      { find: 'tailwind-merge', replacement: pnpmPackageRoot('tailwind-merge') },
      { find: '@nimiplatform/sdk/features/conversation', replacement: path.resolve(__dirname, '../../sdks/typescript/features/conversation/index.ts') },
      { find: '@nimiplatform/sdk/features/generation', replacement: path.resolve(__dirname, '../../sdks/typescript/features/generation/index.ts') },
      { find: '@nimiplatform/sdk/runtime/generated', replacement: path.resolve(__dirname, '../../sdks/typescript/runtime/generated.ts') },
      { find: '@nimiplatform/sdk/realm/generated', replacement: path.resolve(__dirname, '../../sdks/typescript/realm/generated.ts') },
      { find: '@nimiplatform/sdk/contracts', replacement: path.resolve(__dirname, '../../sdks/typescript/core/contracts/index.ts') },
      { find: '@nimiplatform/sdk/runtime', replacement: path.resolve(__dirname, '../../sdks/typescript/runtime/index.ts') },
      { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdks/typescript/realm/index.ts') },
      { find: '@nimiplatform/sdk/types', replacement: path.resolve(__dirname, '../../sdks/typescript/types/index.ts') },
      { find: '@nimiplatform/sdk/app', replacement: path.resolve(__dirname, '../../sdks/typescript/core/app/index.ts') },
      { find: '@nimiplatform/sdk/ai', replacement: path.resolve(__dirname, '../../sdks/typescript/core/ai/index.ts') },
      { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdks/typescript/index.ts') },
      { find: '@nimiplatform/kit/ui', replacement: path.resolve(__dirname, './src/index.ts') },
      { find: '@nimiplatform/kit/features/chat', replacement: path.resolve(__dirname, '../features/chat/src') },
      { find: '@nimiplatform/kit/features/model-config', replacement: path.resolve(__dirname, '../features/model-config/src') },
      { find: '@nimiplatform/kit/features/model-picker', replacement: path.resolve(__dirname, '../features/model-picker/src') },
      { find: '@nimiplatform/kit/features/generation', replacement: path.resolve(__dirname, '../features/generation/src') },
      { find: '@nimiplatform/kit/features/avatar', replacement: path.resolve(__dirname, '../features/avatar/src') },
      { find: '@nimiplatform/kit/features/commerce', replacement: path.resolve(__dirname, '../features/commerce/src') },
      { find: '@nimiplatform/kit/auth', replacement: path.resolve(__dirname, '../auth/src/index.ts') },
      { find: '@nimiplatform/kit/core/shell-mode', replacement: path.resolve(__dirname, '../core/src/shell-mode.ts') },
      { find: '@nimiplatform/kit/core/oauth', replacement: path.resolve(__dirname, '../core/src/oauth') },
      { find: '@nimiplatform/kit/core/desktop-open', replacement: path.resolve(__dirname, '../core/src/desktop-open.ts') },
      { find: '@nimiplatform/kit/core/sdk-contract', replacement: path.resolve(__dirname, '../core/src/sdk-contract.ts') },
      { find: '@nimiplatform/kit/core/runtime-capabilities', replacement: path.resolve(__dirname, '../core/src/runtime-capabilities') },
      { find: '@nimiplatform/kit/core/model-config', replacement: path.resolve(__dirname, '../core/src/model-config') },
      { find: '@nimiplatform/kit/telemetry', replacement: path.resolve(__dirname, '../telemetry/src/telemetry/index.ts') },
      { find: '@nimiplatform/kit/shell/capabilities', replacement: path.resolve(__dirname, '../shell/capabilities/src/index.ts') },
      { find: '@nimiplatform/kit/shell/renderer', replacement: path.resolve(__dirname, '../shell/renderer/src') },
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
