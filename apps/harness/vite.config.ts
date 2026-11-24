import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  cacheDir: '.vite',
  optimizeDeps: { entries: ['index.html'] },
  // The bootstrap creates the root once; only components participate in Fast Refresh.
  plugins: [react({ exclude: [/\/node_modules\//, /\/src\/main\.tsx$/] }), tailwindcss()],
  server: {
    watch: { ignored: ['**/.nimi/local/**', '**/dist/**', '**/dist-electron/**', '**/dist-electron-package/**', '**/dist-web/**', '**/dist-mobile/**', '**/android/**/build/**', '**/android/app/src/main/assets/public/**'] },
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
});
