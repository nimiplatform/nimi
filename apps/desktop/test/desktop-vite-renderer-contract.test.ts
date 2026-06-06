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

test('desktop dev renderer disables HMR to avoid React refresh module preamble in Tauri WebKit', () => {
  assert.match(viteConfigSource, /server:\s*{[\s\S]*hmr:\s*false/);
});

test('desktop dev renderer does not restore archived SDK source aliases', () => {
  assert.doesNotMatch(viteConfigSource, /@nimiplatform\/sdk\/ai-app/);
  assert.doesNotMatch(viteConfigSource, /@nimiplatform\/sdk\/ai-provider/);
  assert.doesNotMatch(viteConfigSource, /['"`]\.\.\/\.\.\/sdk\/src\//);
  assert.match(viteConfigSource, /sdks\/typescript\/dist/);
});

test('desktop agent center local config bridge stays with the agent chat chunk', () => {
  const agentCenterBridgeExceptionIndex = viteConfigSource.indexOf(
    "chat-agent-center-local-config-store.ts')",
  );
  const runtimeBridgeChunkIndex = viteConfigSource.indexOf(
    "return 'runtime-bridge';",
  );

  assert.notEqual(agentCenterBridgeExceptionIndex, -1);
  assert.notEqual(runtimeBridgeChunkIndex, -1);
  assert.ok(
    agentCenterBridgeExceptionIndex < runtimeBridgeChunkIndex,
    'Agent Center local config bridge must be chunked before the generic runtime-bridge catch-all',
  );
  assert.match(
    viteConfigSource.slice(agentCenterBridgeExceptionIndex, runtimeBridgeChunkIndex),
    /return 'chat-agent-shell';/,
  );
});

test('desktop settings dependencies stay out of the agent chat chunk', () => {
  const navigationEventsExceptionIndex = viteConfigSource.indexOf(
    "normalizedId.includes('/runtime-config-navigation-events')",
  );
  const memoryEmbeddingProviderChunkIndex = viteConfigSource.indexOf(
    '/app-shell/providers/desktop-memory-embedding-config-',
  );

  assert.notEqual(navigationEventsExceptionIndex, -1);
  assert.notEqual(memoryEmbeddingProviderChunkIndex, -1);
  assert.match(
    viteConfigSource.slice(navigationEventsExceptionIndex, navigationEventsExceptionIndex + 180),
    /return 'runtime-config-overview';/,
  );
  assert.match(
    viteConfigSource.slice(memoryEmbeddingProviderChunkIndex, memoryEmbeddingProviderChunkIndex + 220),
    /return 'runtime-memory-embedding-config';/,
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
