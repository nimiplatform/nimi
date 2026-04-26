import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'scheduler'],
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
      { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
      { find: '@framework', replacement: path.resolve(__dirname, '.cache/assets/js/CubismSdkForWeb-5-r.5/Framework/src') },
      { find: '@live2d', replacement: path.resolve(__dirname, 'src/shell/renderer/live2d') },
      { find: '@nas', replacement: path.resolve(__dirname, 'src/shell/renderer/nas') },
      { find: '@mock', replacement: path.resolve(__dirname, 'src/shell/renderer/mock') },
      { find: '@driver', replacement: path.resolve(__dirname, 'src/shell/renderer/driver') },
      { find: '@nimiplatform/sdk/runtime/browser', replacement: path.resolve(__dirname, '../../sdk/dist/runtime/browser.js') },
      { find: '@nimiplatform/sdk/runtime', replacement: path.resolve(__dirname, '../../sdk/dist/runtime/index.js') },
      { find: '@nimiplatform/sdk/realm', replacement: path.resolve(__dirname, '../../sdk/dist/realm/index.js') },
      { find: '@nimiplatform/sdk/types', replacement: path.resolve(__dirname, '../../sdk/dist/types/index.js') },
      { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/dist/index.js') },
      { find: '@nimiplatform/nimi-kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src/index.ts') },
      { find: '@nimiplatform/nimi-kit/shell/renderer/bridge', replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bridge/index.ts') },
      { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
      { find: '@nimiplatform/nimi-kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
      { find: '@nimiplatform/nimi-kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
      { find: '@nimiplatform/nimi-kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
      { find: '@tauri-apps/api/core', replacement: path.resolve(__dirname, 'node_modules/@tauri-apps/api/core.js') },
    ],
  },
});
