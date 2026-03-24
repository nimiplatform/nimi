import { defineConfig, searchForWorkspaceRoot } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(() => {
  const workspaceRoot = path.resolve(searchForWorkspaceRoot(process.cwd()));

  return {
    root: path.resolve(__dirname, 'src/renderer'),
    envDir: workspaceRoot,
    envPrefix: ['VITE_', 'NIMI_'],
    define: {
      'globalThis.__NIMI_IMPORT_META_ENV__': 'import.meta.env',
    },
    publicDir: false,
    resolve: {
      dedupe: ['react', 'react-dom', 'scheduler'],
      alias: [
        { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js') },
        { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js') },
        { find: 'react-dom/client', replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js') },
        { find: 'react-dom', replacement: path.resolve(__dirname, 'node_modules/react-dom/index.js') },
        { find: 'react', replacement: path.resolve(__dirname, 'node_modules/react/index.js') },
        { find: '@renderer', replacement: path.resolve(__dirname, 'src/renderer') },
        { find: '@nimiplatform/sdk', replacement: path.resolve(__dirname, '../../sdk/src') },
        { find: '@nimiplatform/nimi-kit/ui', replacement: path.resolve(__dirname, '../../kit/ui/src') },
      ],
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: '127.0.0.1',
      port: 1430,
      strictPort: true,
      fs: {
        allow: [
          workspaceRoot,
          path.resolve(__dirname),
        ],
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 700, // pixi.js lazy chunk is ~620KB
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'src/renderer/index.html'),
        },
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join('/');

            if (normalizedId.includes('/sdk/src/runtime/generated/')) {
              return 'sdk-runtime-generated';
            }
            if (normalizedId.includes('/sdk/src/realm/generated/')) {
              return 'sdk-realm-generated';
            }
            if (normalizedId.includes('/sdk/src/scope/generated/')) {
              return 'sdk-scope-generated';
            }
            if (normalizedId.includes('/sdk/src/')) {
              return 'sdk-client';
            }
            if (
              normalizedId.includes('/kit/auth/src/')
              || normalizedId.includes('/kit/ui/src/')
              || normalizedId.includes('/kit/core/src/oauth/')
            ) {
              return 'shell-auth';
            }
            if (normalizedId.includes('/apps/relay/src/renderer/features/buddy/')) {
              return 'buddy-canvas';
            }

            if (!normalizedId.includes('node_modules')) {
              return undefined;
            }
            if (
              normalizedId.includes('/react/')
              || normalizedId.includes('/react-dom/')
              || normalizedId.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (normalizedId.includes('/react-router') || normalizedId.includes('/@remix-run/router/')) {
              return 'vendor-router';
            }
            if (
              normalizedId.includes('/@tanstack/react-query/')
              || normalizedId.includes('/@tanstack/query-core/')
            ) {
              return 'vendor-query';
            }
            if (normalizedId.includes('/zustand/')) {
              return 'vendor-state';
            }
            if (normalizedId.includes('/i18next/') || normalizedId.includes('/react-i18next/')) {
              return 'vendor-i18n';
            }
            if (
              normalizedId.includes('/react-markdown/')
              || normalizedId.includes('/remark-gfm/')
              || normalizedId.includes('/remark-')
              || normalizedId.includes('/rehype-')
              || normalizedId.includes('/micromark')
              || normalizedId.includes('/mdast-')
              || normalizedId.includes('/hast-')
              || normalizedId.includes('/unist-')
              || normalizedId.includes('/vfile')
              || normalizedId.includes('/unified/')
              || normalizedId.includes('/property-information/')
              || normalizedId.includes('/decode-named-character-reference/')
              || normalizedId.includes('/comma-separated-tokens/')
              || normalizedId.includes('/space-separated-tokens/')
              || normalizedId.includes('/style-to-object/')
              || normalizedId.includes('/style-to-js/')
              || normalizedId.includes('/html-url-attributes/')
              || normalizedId.includes('/markdown-table/')
              || normalizedId.includes('/trim-lines/')
              || normalizedId.includes('/inline-style-parser/')
              || normalizedId.includes('/ccount/')
              || normalizedId.includes('/longest-streak/')
              || normalizedId.includes('/devlop/')
              || normalizedId.includes('/bail/')
              || normalizedId.includes('/trough/')
              || normalizedId.includes('/extend/')
              || normalizedId.includes('/is-plain-obj/')
            ) {
              return 'vendor-markdown';
            }
            if (normalizedId.includes('/lucide-react/')) {
              return 'vendor-icons';
            }
            if (
              normalizedId.includes('/@nimiplatform/sdk/')
              || normalizedId.includes('/@nimiplatform/nimi-kit/auth/')
              || normalizedId.includes('/@nimiplatform/nimi-kit/core/')
              || normalizedId.includes('/openapi-fetch/')
            ) {
              return 'vendor-platform';
            }
            if (
              normalizedId.includes('/pixi.js/')
              || normalizedId.includes('/pixi-live2d-display/')
              || normalizedId.includes('/three/')
              || normalizedId.includes('/simplex-noise/')
            ) {
              return 'buddy-canvas';
            }
            return 'vendor-misc';
          },
        },
      },
    },
  };
});
