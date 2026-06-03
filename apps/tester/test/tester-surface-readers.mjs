import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readMany(root, files) {
  return files.map((file) => read(root, file)).join('\n');
}

export function readTesterKitComponentGallerySurface(root) {
  return readMany(root, [
    'src/tester/kit-component-gallery.tsx',
    'src/tester/kit-component-gallery-surface.tsx',
  ]);
}

export function readTesterRuntimeInvokersSurface(root) {
  return readMany(root, [
    'src/tester/tester-runtime-invokers.ts',
    'src/tester/tester-runtime-invokers-core.ts',
    'src/tester/tester-runtime-invokers-media.ts',
  ]);
}

export function readTesterAiTestingSurface(root) {
  return readMany(root, [
    'src/tester/workbench/section-ai-testing.tsx',
    'src/tester/workbench/section-ai-testing-surface.tsx',
  ]);
}
