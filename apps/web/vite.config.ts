import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ['VITE_', 'NIMI_'],
  define: {
    'import.meta.env.VITE_NIMI_SHELL_MODE': JSON.stringify('web'),
  },
  resolve: {
    alias: [
      {
        find: '@renderer/infra/bootstrap/runtime-bootstrap',
        replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-bootstrap.web.ts'),
      },
      {
        find: '@renderer/mod-ui/host/slot-host',
        replacement: path.resolve(__dirname, 'src/desktop-adapter/slot-host.web.tsx'),
      },
      {
        find: '@renderer/mod-ui/host/slot-context',
        replacement: path.resolve(__dirname, 'src/desktop-adapter/slot-context.web.ts'),
      },
      {
        find: '@renderer/features/mod-workspace/mod-workspace-tabs',
        replacement: path.resolve(__dirname, 'src/desktop-adapter/mod-workspace-tabs.web.tsx'),
      },
      {
        find: '@renderer/features/runtime-config/runtime-config-panel-view',
        replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-config-panel.web.tsx'),
      },
      {
        find: '@renderer/features/marketplace/marketplace-page',
        replacement: path.resolve(__dirname, 'src/desktop-adapter/marketplace-page.web.tsx'),
      },
      {
        find: /^@renderer\/bridge$/,
        replacement: path.resolve(__dirname, 'src/desktop-adapter/bridge.web.ts'),
      },
      {
        find: /^@runtime\/mod$/,
        replacement: path.resolve(__dirname, 'src/desktop-adapter/runtime-mod.web.ts'),
      },
      {
        find: '@runtime',
        replacement: path.resolve(__dirname, '../desktop/src/runtime'),
      },
      {
        find: '@renderer',
        replacement: path.resolve(__dirname, '../desktop/src/shell/renderer'),
      },
      {
        find: '@mods',
        replacement: path.resolve(__dirname, '../desktop/src/mods'),
      },
      {
        find: '@nimiplatform/sdk-realm',
        replacement: path.resolve(__dirname, '../../sdk/packages/realm/src'),
      },
      {
        find: '@nimiplatform/mod-sdk',
        replacement: path.resolve(__dirname, '../../sdk/packages/mod-sdk/src'),
      },
      {
        find: '@nimiplatform/shell-core',
        replacement: path.resolve(__dirname, '../_libs/shell-core/src'),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
          if (id.includes('/react-router') || id.includes('/@remix-run/router/')) {
            return 'vendor-router';
          }
          if (id.includes('/@tanstack/react-query/')) {
            return 'vendor-query';
          }
          if (id.includes('/i18next/') || id.includes('/react-i18next/')) {
            return 'vendor-i18n';
          }
          if (id.includes('/@nimiplatform/sdk') || id.includes('/ai/') || id.includes('/@ai-sdk/')) {
            return 'vendor-ai';
          }
          if (id.includes('/three/') || id.includes('/simplex-noise/')) {
            return 'vendor-3d';
          }
          if (id.includes('/zustand/')) {
            return 'vendor-state';
          }
          return 'vendor-misc';
        },
      },
    },
  },
});
