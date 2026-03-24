import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
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
      { find: '@renderer', replacement: path.resolve(__dirname, 'src/shell/renderer') },
      { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/src') },
      { find: '@nimiplatform/nimi-ui', replacement: path.resolve(__dirname, '../_libs/nimi-ui/src') },
      { find: '@nimiplatform/shell-auth', replacement: path.resolve(__dirname, '../_libs/shell-auth/src') },
      { find: '@nimiplatform/shell-core', replacement: path.resolve(__dirname, '../_libs/shell-core/src') },
    ],
  },
});
