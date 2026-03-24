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
    ],
  },
  test: {
    environment: 'node',
    include: ['ui/test/**/*.test.tsx'],
  },
});
