import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
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
      { find: '@engine', replacement: path.resolve(__dirname, 'src/shell/renderer/engine') },
      { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/src') },
      { find: '@nimiplatform/nimi-kit/features/model-picker', replacement: path.resolve(__dirname, '../../kit/features/model-picker/src') },
      { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
      { find: '@nimiplatform/nimi-kit/auth', replacement: path.resolve(__dirname, '../../kit/auth/src') },
      { find: '@nimiplatform/nimi-kit/core', replacement: path.resolve(__dirname, '../../kit/core/src') },
      { find: '@nimiplatform/nimi-kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
      { find: '@nimiplatform/nimi-kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
      { find: '@nimiplatform/nimi-kit/shell/renderer/bridge', replacement: path.resolve(__dirname, '../../kit/shell/renderer/src/bridge/index.ts') },
      { find: '@nimiplatform/nimi-kit/features/chat/ui', replacement: path.resolve(__dirname, '../../kit/features/chat/src/ui.ts') },
      { find: '@nimiplatform/nimi-kit/features/chat', replacement: path.resolve(__dirname, '../../kit/features/chat/src/index.ts') },
      { find: '@nimiplatform/nimi-kit/core/oauth', replacement: path.resolve(__dirname, '../../kit/core/src/oauth/index.ts') },
      { find: '@tauri-apps/api/core', replacement: path.resolve(__dirname, 'node_modules/@tauri-apps/api/core.js') },
    ],
  },
});
