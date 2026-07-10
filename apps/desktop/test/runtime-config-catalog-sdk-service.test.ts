import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const catalogSdkServiceSource = readFileSync(
  fileURLToPath(new URL('../src/shell/renderer/features/runtime-config/runtime-config-catalog-sdk-service.ts', import.meta.url)),
  'utf8',
);

test('Desktop catalog service is only an SDK runtime catalog client binding', () => {
  assert.match(catalogSdkServiceSource, /createNimiRuntimeModelCatalogClient/);
  assert.match(catalogSdkServiceSource, /getDesktopRuntime\(\)\.connectors/);
  assert.match(catalogSdkServiceSource, /surfaceId: 'runtime\.config'/);
  assert.doesNotMatch(catalogSdkServiceSource, /callerKind|callerId/);
  assert.doesNotMatch(catalogSdkServiceSource, /getPlatformClient/);
  assert.doesNotMatch(catalogSdkServiceSource, /function normalize/);
  assert.doesNotMatch(catalogSdkServiceSource, /runtimeJsonToProtoStruct|runtimeProtoStructToJson|jsonToProtoStruct|protoStructToJson/);
  assert.doesNotMatch(catalogSdkServiceSource, /export function .*Catalog/);
  assert.doesNotMatch(catalogSdkServiceSource, /export async function .*Catalog/);
});
