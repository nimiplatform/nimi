import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteConfigSource = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
const rendererEntryHtml = fs.readFileSync(
  path.join(root, 'src/shell/renderer/index.html'),
  'utf8',
);
const live2dRuntimeLoaderSource = fs.readFileSync(
  path.join(root, 'src/shell/renderer/features/chat/chat-agent-avatar-live2d-cubism-runtime-loader.ts'),
  'utf8',
);
const live2dRuntimeSource = fs.readFileSync(
  path.join(root, 'src/shell/renderer/features/chat/chat-agent-avatar-live2d-cubism-runtime.ts'),
  'utf8',
);

test('desktop production renderer does not inject Vite modulepreload fetch polyfills', () => {
  assert.match(viteConfigSource, /modulePreload:\s*{/);
  assert.match(viteConfigSource, /polyfill:\s*false/);
  assert.match(viteConfigSource, /resolveDependencies:\s*\(\)\s*=>\s*\[\]/);
  assert.doesNotMatch(
    viteConfigSource,
    /resolveDependencies:\s*\([^)]*deps[^)]*\)\s*=>\s*deps/,
  );
});

test('desktop renderer entrypoint is packaged-local and has no remote boot resources', () => {
  assert.doesNotMatch(rendererEntryHtml, /https?:\/\//);
  assert.doesNotMatch(rendererEntryHtml, /fonts\.(googleapis|gstatic)\.com/);
  assert.doesNotMatch(rendererEntryHtml, /live2dcubismcore\.min\.js/);
});

test('desktop Live2D Cubism Core is loaded only by the avatar runtime path', () => {
  assert.match(
    live2dRuntimeLoaderSource,
    /assets\/js\/live2d-cubism-core\/Core\/live2dcubismcore\.min\.js/,
  );
  assert.match(live2dRuntimeLoaderSource, /createElement\('script'\)/);
  assert.match(live2dRuntimeLoaderSource, /Live2D Cubism Core script loaded without publishing Live2DCubismCore/);
  assert.match(live2dRuntimeSource, /await ensureLive2dCubismCoreLoaded\(\)/);
});
