import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Standalone prototype build (variant 2 — "field" aesthetic study).
// It consumes governed Kit UI CSS without app runtime aliases or env ingestion.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5200, strictPort: true },
  build: { sourcemap: false },
});
