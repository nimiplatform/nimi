import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assetPaths = [
  'auth/src/styles.css',
  'ui/src/styles.css',
  'ui/src/themes/light.css',
  'ui/src/themes/dark.css',
  'ui/src/themes/nimi-accent.css',
  'ui/src/themes/forge-accent.css',
  'ui/src/themes/overtone-accent.css',
  'ui/src/themes/video-food-map-accent.css',
];

for (const relativePath of assetPaths) {
  const source = path.join(kitRoot, relativePath);
  const target = path.join(kitRoot, 'dist', relativePath.replace('/src/', '/'));
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
}
