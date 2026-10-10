import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  cacheDir: '.vite',
  plugins: [react({ exclude: [/\/node_modules\//, /\/src\/(?:shell\/renderer\/)?main\.tsx$/] }), tailwindcss()],
  server: {
    watch: { ignored: ['**/.nimi/local/**', '**/dist/**', '**/dist-electron/**', '**/dist-electron-package/**', '**/.dist-electron-package.staging-*/**', '**/.dist-electron-package.previous-*/**'] },
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
});
