import { defineConfig, loadEnv, mergeConfig } from 'vite';
import { nimiWebViteConfig } from '@nimiplatform/app-tools/web';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const nativeConfig = {
  base: './',
  plugins: [react({ exclude: [/\/node_modules\//, /\/src\/(?:shell\/renderer\/)?main\.tsx$/] }), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    alias: [
      { find: '@nimiplatform/kit/core', replacement: path.join(repoRoot, 'kit/core/src') },
      { find: '@nimiplatform/kit/shell/capabilities', replacement: path.join(repoRoot, 'kit/shell/capabilities/src') },
      { find: '@nimiplatform/kit/shell/renderer/bridge', replacement: path.join(repoRoot, 'kit/shell/renderer/src/bridge') },
    ],
  },
  optimizeDeps: {
    exclude: [
      '@nimiplatform/kit/core',
      '@nimiplatform/kit/shell/capabilities',
      '@nimiplatform/kit/shell/renderer/bridge',
    ],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
    watch: { ignored: ['**/dist-web/**', '**/.tmp/**'] },
  },
};
export default defineConfig(({ command, mode }) => {
  if (mode !== 'web') return nativeConfig;
  const web = nimiWebViteConfig({ root: __dirname, env: { ...loadEnv(mode, __dirname, ''), ...process.env }, serve: command === 'serve' });
  return mergeConfig(nativeConfig, {
    ...web,
    plugins: [...(web.plugins || []),
      { name: 'zhiyu-web-entry', transformIndexHtml: { order: 'pre' as const, handler: (html: string) => html.replace('/src/main.tsx', '/src/web/main.tsx') } }],
    build: { outDir: 'dist-web' },
  });
});
