import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const previewRoot = path.dirname(fileURLToPath(import.meta.url));
const kitUiSrc = path.resolve(previewRoot, '../ui/src');

/**
 * Nimi Kit Preview — the design-system workbench for agents and humans.
 *
 * Resolves `@nimiplatform/kit/ui` to kit SOURCE (not dist) so the
 * audit → modify → accept loop reflects edits immediately.
 */
export default defineConfig({
  root: previewRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@nimiplatform/kit/ui/motion': path.join(kitUiSrc, 'motion/index.ts'),
      '@nimiplatform/kit/ui/glass': path.join(kitUiSrc, 'glass/index.ts'),
      '@nimiplatform/kit/ui/a11y': path.join(kitUiSrc, 'a11y/index.ts'),
      '@nimiplatform/kit/ui': path.join(kitUiSrc, 'index.ts'),
    },
  },
  build: {
    outDir: path.join(previewRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 1470,
    strictPort: true,
  },
  preview: {
    port: 1470,
    strictPort: true,
  },
});
