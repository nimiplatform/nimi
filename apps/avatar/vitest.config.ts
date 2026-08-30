import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

const repoRoot = path.resolve(__dirname, '../..');
const pnpmRoot = path.join(repoRoot, 'node_modules/.pnpm');
const sdkVNextDist = path.resolve(__dirname, '../../sdks/typescript/dist');

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
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'scheduler', '@radix-ui/react-switch'],
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
      { find: '@radix-ui/react-switch', replacement: pnpmPackageRoot('@radix-ui/react-switch') },
      { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
      { find: '@framework', replacement: path.resolve(__dirname, '.cache/assets/js/CubismSdkForWeb-5-r.5/Framework/src') },
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
});
