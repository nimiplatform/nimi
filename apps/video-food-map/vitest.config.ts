import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'scheduler'],
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/server', replacement: path.resolve(__dirname, 'node_modules/react-dom/server.node.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
      { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
      { find: 'scheduler', replacement: path.resolve(__dirname, 'node_modules/scheduler/index.js') },
      { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
      { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
      { find: '@nimiplatform/nimi-kit/telemetry/error-boundary', replacement: path.resolve(__dirname, '../../kit/telemetry/src/error-boundary/index.ts') },
      { find: '@nimiplatform/nimi-kit/telemetry', replacement: path.resolve(__dirname, '../../kit/telemetry/src/telemetry/index.ts') },
    ],
  },
});
