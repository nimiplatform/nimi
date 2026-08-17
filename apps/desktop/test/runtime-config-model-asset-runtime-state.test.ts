import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import {
  modelAssetCatalogLookupKeys,
  runtimeInventoryErrorFromSlots,
} from '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.js';

test('a successful sibling refresh cannot clear the ModelAsset inventory error slot', () => {
  assert.equal(runtimeInventoryErrorFromSlots({
    'model-assets': 'Runtime ModelAsset discovery failed.',
    'verified-assets': '',
  }), 'Runtime ModelAsset discovery failed.');
});

test('Local Models catalog installed state is derived from ModelAsset provenance', () => {
  const keys = modelAssetCatalogLookupKeys({
    provenance: {
      catalog_asset_id: 'model.qwen3.gguf',
      catalog_template_id: 'MODEL.QWEN3.TEMPLATE',
      source_repo: 'Nimi/Qwen3',
    },
  } as unknown as NimiRuntimeModelAssetRecord);
  assert.deepEqual(keys, [
    'model.qwen3.gguf',
    'model.qwen3.template',
  ]);
  assert.deepEqual(modelAssetCatalogLookupKeys({
    provenance: { source_repo: 'Nimi/Qwen3' },
  } as unknown as NimiRuntimeModelAssetRecord), []);
});
