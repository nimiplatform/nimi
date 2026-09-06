import assert from 'node:assert/strict';
import test from 'node:test';

import { runtimeInventoryErrorFromSlots } from '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.js';

test('Local Assets prioritizes the ModelAsset action error over the inventory read error', () => {
  assert.equal(runtimeInventoryErrorFromSlots({
    'model-assets': 'Runtime ModelAsset inventory failed.',
    'model-asset-action': 'Runtime ModelAsset removal failed.',
  }), 'Runtime ModelAsset removal failed.');
  assert.equal(runtimeInventoryErrorFromSlots({
    'model-assets': 'Runtime ModelAsset inventory failed.',
  }), 'Runtime ModelAsset inventory failed.');
});

test('installed assets retain tokenized name, entry and content-ID search', async () => {
  const { filterModelAssetsForSearch } = await import('../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-section.js');
  const asset = {
    modelAssetId: 'model_qwen',
    displayName: 'local.tts.qwen3-tts-customvoice-1.7b.audio-cpp.q8-0.cuda',
    entry: 'Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf',
    contentId: 'sha256:3cfa',
  } as import('@nimiplatform/sdk/runtime').NimiRuntimeModelAssetRecord;
  for (const query of ['qwen3-tts-audio-cpp', ' QWEN3.tts_audio cpp ', 'sha256:3cfa', 'model_qwen q8_0']) {
    assert.deepEqual(filterModelAssetsForSearch([asset], query), [asset], query);
  }
  assert.deepEqual(filterModelAssetsForSearch([asset], 'qwen3 missing'), []);
  assert.deepEqual(filterModelAssetsForSearch([asset], '   '), [asset]);
});
