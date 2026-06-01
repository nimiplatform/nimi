import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const capabilitySettingsSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/capability-settings-shared.tsx'),
  'utf8',
);

const memoryEmbeddingServiceSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.ts'),
  'utf8',
);

test('Desktop local runtime asset consumers use SDK projection instead of raw Runtime DTOs', () => {
  assert.match(capabilitySettingsSource, /listRuntimeLocalAssetEntries/);
  assert.match(capabilitySettingsSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.doesNotMatch(capabilitySettingsSource, /runtime\.local\.listLocalAssets/);
  assert.doesNotMatch(capabilitySettingsSource, /statusFilter:\s*0/);
  assert.doesNotMatch(capabilitySettingsSource, /kindFilter:\s*0/);
});

test('Desktop memory embedding host does not own Runtime protected access', () => {
  assert.match(memoryEmbeddingServiceSource, /createProtectedHostMemoryEmbeddingRuntimeSurface/);
  assert.doesNotMatch(memoryEmbeddingServiceSource, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(memoryEmbeddingServiceSource, /withRuntimeMemoryScopes/);
});
