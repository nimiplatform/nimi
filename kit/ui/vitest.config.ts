import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom', 'scheduler'],
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react/jsx-dev-runtime.js') },
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react/jsx-runtime.js') },
      { find: 'react-dom/server', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react-dom/server.node.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react-dom/client.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react-dom/index.js') },
      { find: 'react', replacement: path.resolve(__dirname, '../../apps/desktop/node_modules/react/index.js') },
      { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, './src/index.ts') },
      { find: '@nimiplatform/nimi-kit/features/chat', replacement: path.resolve(__dirname, '../features/chat/src') },
      { find: '@nimiplatform/nimi-kit/features/model-config', replacement: path.resolve(__dirname, '../features/model-config/src') },
      { find: '@nimiplatform/nimi-kit/features/model-picker', replacement: path.resolve(__dirname, '../features/model-picker/src') },
      { find: '@nimiplatform/nimi-kit/features/generation', replacement: path.resolve(__dirname, '../features/generation/src') },
      { find: '@nimiplatform/nimi-kit/core/runtime-capabilities', replacement: path.resolve(__dirname, '../core/src/runtime-capabilities') },
      { find: '@nimiplatform/nimi-kit/core/model-config', replacement: path.resolve(__dirname, '../core/src/model-config') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['**/test/**/*.test.ts', '**/test/**/*.test.tsx'],
  },
});
