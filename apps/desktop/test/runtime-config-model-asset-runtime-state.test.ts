import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import {
  filterModelAssetsForSearch,
  filterVerifiedModelsForSearch,
  modelAssetCatalogLookupKeys,
  runtimeInventoryErrorFromSlots,
} from '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.js';

test('verified runnable model search is not truncated to quick picks', () => {
  const models = Array.from({ length: 7 }, (_, index) => ({
    assetId: index === 6 ? 'local.tts.qwen3-tts-customvoice-1.7b.audio-cpp.q8-0.cuda' : `local.chat.model-${index}`,
    templateId: `template-${index}`,
    title: index === 6 ? 'Qwen3-TTS CustomVoice audio.cpp' : `Model ${index}`,
    description: '',
    kind: index === 6 ? 'tts' : 'llm',
    repo: index === 6 ? 'audio-cpp/audio.cpp-gguf' : 'example/repo',
    capabilities: index === 6 ? ['audio.synthesize'] : ['text.generate'],
    tags: [],
  }));
  assert.deepEqual(
    filterVerifiedModelsForSearch(models as never, 'qwen3-tts-audio'),
    [models[6]],
  );
});

test('installed ModelAsset uses the same tokenized search semantics', () => {
  const asset = {
    modelAssetId: 'model_qwen',
    displayName: 'local.tts.qwen3-tts-customvoice-1.7b.audio-cpp.q8-0.cuda',
    entry: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf',
    contentId: 'sha256:3cfa',
  } as unknown as NimiRuntimeModelAssetRecord;
  assert.deepEqual(filterModelAssetsForSearch([asset], 'qwen3-tts-audio-cpp'), [asset]);
});

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
