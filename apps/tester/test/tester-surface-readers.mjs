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
    'src/tester/kit-component-gallery-recipes.tsx',
    'src/tester/kit-component-gallery-data-recipes.tsx',
    'src/tester/kit-component-gallery-demos.tsx',
  ]);
}

export function readTesterRuntimeInvokersSurface(root) {
  return readMany(root, [
    'src/tester/tester-runtime-invokers.ts',
    'src/tester/tester-runtime-invokers-core.ts',
    'src/tester/tester-runtime-invokers-media.ts',
    'src/tester/tester-runtime-invokers-media-artifacts.ts',
    'src/tester/tester-runtime-invokers-media-environment.ts',
    'src/tester/tester-runtime-invokers-media-image-video.ts',
    'src/tester/tester-runtime-invokers-media-params.ts',
    'src/tester/tester-runtime-invokers-media-runtime.ts',
    'src/tester/tester-runtime-invokers-media-speech.ts',
  ]);
}

export function readTesterAiTestingSurface(root) {
  return readMany(root, [
    'src/tester/workbench/section-ai-testing.tsx',
    'src/tester/workbench/section-ai-testing-composer.tsx',
    'src/tester/workbench/section-ai-testing-result.tsx',
    'src/tester/workbench/section-ai-testing-run.ts',
    'src/tester/workbench/section-ai-testing-surface.tsx',
    'src/tester/workbench/section-ai-testing-history.tsx',
    'src/tester/workbench/section-ai-testing-model-config.tsx',
    'src/tester/workbench/section-ai-testing-output.tsx',
    'src/tester/workbench/section-ai-testing-studio-result.tsx',
    'src/tester/tester-export.ts',
  ]);
}
