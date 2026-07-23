import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const capabilitySettingsSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/capability-settings-shared.tsx'),
  'utf8',
);

const sdkRuntimeLocalAssetsSource = readFileSync(
  resolve(import.meta.dirname, '../../../sdks/typescript/runtime/runtime-local-assets.ts'),
  'utf8',
);

const modelConfigTypesSource = readFileSync(
  resolve(import.meta.dirname, '../../../kit/features/model-config/src/types.ts'),
  'utf8',
);

const modelConfigCoreTypesSource = readFileSync(
  resolve(import.meta.dirname, '../../../kit/core/src/model-config/types.ts'),
  'utf8',
);

const modelConfigConstantsSource = readFileSync(
  resolve(import.meta.dirname, '../../../kit/features/model-config/src/constants.ts'),
  'utf8',
);

const memoryEmbeddingServicePath = resolve(
  import.meta.dirname,
  '../src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.ts',
);

test('Desktop local runtime asset consumers use SDK projection instead of raw Runtime DTOs', () => {
  assert.match(capabilitySettingsSource, /listNimiRuntimeLocalAssetEntries/);
  assert.match(capabilitySettingsSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(capabilitySettingsSource, /sdk\.machineProduct\(\)/);
  assert.doesNotMatch(capabilitySettingsSource, /getPlatformClient/);
  assert.doesNotMatch(capabilitySettingsSource, /listRuntimeLocalAssetEntries/);
  assert.doesNotMatch(capabilitySettingsSource, /runtime\.local\.listLocalAssets/);
  assert.doesNotMatch(capabilitySettingsSource, /statusFilter:\s*0/);
  assert.doesNotMatch(capabilitySettingsSource, /kindFilter:\s*0/);
});

test('SDK and Kit local asset projection keeps generated enums behind UI-readable ids', () => {
  assert.match(sdkRuntimeLocalAssetsSource, /listNimiRuntimeLocalAssetEntries/);
  assert.match(sdkRuntimeLocalAssetsSource, /parseNimiRuntimeLocalAssetKindId/);
  assert.match(sdkRuntimeLocalAssetsSource, /parseNimiRuntimeLocalAssetStatusId/);
  assert.doesNotMatch(sdkRuntimeLocalAssetsSource, /export async function listRuntimeLocalAssetEntries/);
  assert.doesNotMatch(modelConfigTypesSource, /kind:\s*number/);
  assert.doesNotMatch(modelConfigTypesSource, /status:\s*number/);
  assert.match(modelConfigTypesSource, /kind:\s*string/);
  assert.match(modelConfigTypesSource, /status:\s*string/);
  assert.doesNotMatch(modelConfigCoreTypesSource, /kind:\s*number/);
  assert.doesNotMatch(modelConfigCoreTypesSource, /status:\s*number/);
  assert.match(modelConfigCoreTypesSource, /kind:\s*string/);
  assert.match(modelConfigCoreTypesSource, /status:\s*string/);
  assert.match(modelConfigConstantsSource, /ASSET_KIND_MAP:\s*Record<string,\s*readonly string\[\]>/);
  assert.doesNotMatch(modelConfigConstantsSource, /Record<string,\s*number\[]>/);
  assert.doesNotMatch(modelConfigConstantsSource, /a\.status\s*!==\s*4/);
  assert.match(modelConfigConstantsSource, /a\.status\s*!==\s*'removed'/);
});

test('Desktop memory embedding lifecycle host surface is removed', () => {
  assert.equal(existsSync(memoryEmbeddingServicePath), false);
});
