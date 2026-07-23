import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const deadLifecycleSurface = path.resolve(
  process.cwd(),
  'src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.ts',
);
const runtimeConfigSectionSource = readFileSync(
  path.resolve(process.cwd(), 'src/shell/renderer/features/runtime-config/runtime-config-memory-embedding-section.tsx'),
  'utf-8',
);
const sdkProjectionSource = readFileSync(
  path.resolve(process.cwd(), '../../sdks/typescript/runtime/memory-embedding-surfaces.ts'),
  'utf-8',
);

test('desktop memory embedding lifecycle reachability is removed while Runtime Config remains route-only', () => {
  assert.equal(existsSync(deadLifecycleSurface), false);
  assert.doesNotMatch(runtimeConfigSectionSource, /InspectMemoryEmbeddingRuntime/);
  assert.doesNotMatch(runtimeConfigSectionSource, /RequestMemoryEmbeddingRuntimeBind/);
  assert.doesNotMatch(runtimeConfigSectionSource, /RequestMemoryEmbeddingRuntimeCutover/);
  assert.doesNotMatch(runtimeConfigSectionSource, /getDesktopMemoryEmbeddingConfigService/);
  assert.match(runtimeConfigSectionSource, /routeOptions|text\.embed-route-availability/);
});

test('SDK retains the Runtime-private memory projection without Desktop lifecycle activation', () => {
  assert.match(sdkProjectionSource, /inspectMemoryEmbeddingRuntime/);
  assert.match(sdkProjectionSource, /requestMemoryEmbeddingRuntimeBind/);
  assert.match(sdkProjectionSource, /requestMemoryEmbeddingRuntimeCutover/);
  assert.doesNotMatch(runtimeConfigSectionSource, /memoryEmbeddingRuntime\.(inspect|requestBind|requestCutover)/);
});
