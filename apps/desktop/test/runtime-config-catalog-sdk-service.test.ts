import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const catalogSdkServiceSource = readFileSync(
  fileURLToPath(new URL('../src/shell/renderer/features/runtime-config/runtime-config-catalog-sdk-service.ts', import.meta.url)),
  'utf8',
);

test('Desktop catalog service is only an SDK runtime catalog client binding', () => {
  assert.match(catalogSdkServiceSource, /createRuntimeModelCatalogClient/);
  assert.match(catalogSdkServiceSource, /getPlatformClient\(\)\.domains\.runtimeAdmin/);
  assert.match(catalogSdkServiceSource, /callerId: 'runtime-config\.catalog'/);
  assert.doesNotMatch(catalogSdkServiceSource, /function normalize/);
  assert.doesNotMatch(catalogSdkServiceSource, /runtimeJsonToProtoStruct|runtimeProtoStructToJson|jsonToProtoStruct|protoStructToJson/);
  assert.doesNotMatch(catalogSdkServiceSource, /upsertCatalogModelOverlay\(/);
  assert.doesNotMatch(catalogSdkServiceSource, /listModelCatalogProviders\(/);
});
