import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readTesterKitGallerySurface(repoRoot: string | URL): string {
  const root = repoRoot instanceof URL ? fileURLToPath(repoRoot) : repoRoot;
  return [
    'apps/tester/src/tester/kit-component-gallery.tsx',
    'apps/tester/src/tester/kit-component-gallery-surface.tsx',
  ].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n');
}
