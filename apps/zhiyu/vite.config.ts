import { defineConfig, loadEnv, mergeConfig } from 'vite';
import { nimiWebViteConfig } from '@nimiplatform/app-tools/web';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nativeConfig = {
  base: './',
  plugins: [react({ exclude: [/\/node_modules\//, /\/src\/(?:shell\/renderer\/)?main\.tsx$/] }), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  server: {
    watch: { ignored: ['**/dist-web/**', '**/dist-mobile/**', '**/android/**', '**/.tmp/**'] },
  },
};
export default defineConfig(({ command, mode }) => {
  if (mode === 'mobile') return mergeConfig(nativeConfig, {
    plugins: [{ name: 'zhiyu-mobile-entry', transformIndexHtml: { order: 'pre' as const, handler: (html: string) => html.replace('/src/main.tsx', '/src/mobile/main.tsx') } }],
    build: { outDir: 'dist-mobile' },
  });
  if (mode !== 'web') return nativeConfig;
  const web = nimiWebViteConfig({ root: __dirname, env: { ...loadEnv(mode, __dirname, ''), ...process.env }, serve: command === 'serve' });
  return mergeConfig(nativeConfig, {
    ...web,
    plugins: [...(web.plugins || []),
      { name: 'zhiyu-web-entry', transformIndexHtml: { order: 'pre' as const, handler: (html: string) => html.replace('/src/main.tsx', '/src/web/main.tsx') } }],
    build: { outDir: 'dist-web' },
  });
});
