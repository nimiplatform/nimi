import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectCssFiles(relativeDir, files = []) {
  const absoluteDir = path.join(kitRoot, relativeDir);
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      collectCssFiles(relativePath, files);
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(relativePath);
    }
  }
  return files;
}

for (const relativePath of [
  ...collectCssFiles('auth/src'),
  ...collectCssFiles('ui/src'),
]) {
  const source = path.join(kitRoot, relativePath);
  // Strip the `/src/` segment to match normalize-dist-layout's flattening and the
  // package `exports` map (e.g. ./dist/ui/styles.css). Separator-agnostic: on
  // Windows path.join yields backslashes, so a literal '/src/' replace would no-op
  // and leak assets to dist/ui/src/.
  const flattened = relativePath.split(path.sep).join('/').replace('/src/', '/');
  const target = path.join(kitRoot, 'dist', flattened);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
}
