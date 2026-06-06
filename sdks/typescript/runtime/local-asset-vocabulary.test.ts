import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GpuMemoryModel,
  LocalAssetKind,
  LocalEngineRuntimeMode,
  LocalProfileEntryKind,
} from '../core-generated/runtime-typed-client';
import {
  NIMI_RUNTIME_LOCAL_ASSET_KIND_IDS,
  NIMI_RUNTIME_LOCAL_ENGINE_IDS,
  NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_IDS,
  NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS,
  canImportNimiRuntimeLocalAssetDeclaration,
  compareNimiRuntimeLocalAssetKindForDisplay,
  formatNimiRuntimeLocalAssetKindLabel,
  isNimiRuntimeLocalRunnableAssetKindId,
  normalizeNimiRuntimeLocalAssetDeclaration,
  normalizeNimiRuntimeLocalDependencyAssetDeclaration,
  normalizeNimiRuntimeLocalEngineRuntimeModeId,
  normalizeNimiRuntimeLocalRunnableAssetKindId,
  parseNimiRuntimeLocalAssetKindId,
  parseNimiRuntimeLocalGpuMemoryModelId,
  parseNimiRuntimeLocalProfileEntryKindId,
  toNimiRuntimeLocalAssetKindRequestValue,
  toNimiRuntimeLocalEngineRuntimeModeRequestValue,
  toNimiRuntimeLocalGpuMemoryModelRequestValue,
  toNimiRuntimeLocalProfileEntryKindRequestValue,
  nimiRuntimeLocalCapabilitiesForAssetKind,
  nimiRuntimeLocalRunnableAssetKindForCapabilities,
} from './index';

describe('Nimi Runtime local asset vocabulary', () => {
  it('exposes UI-readable local asset and engine options', () => {
    assert.deepEqual(NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS, [
      'chat',
      'image',
      'video',
      'tts',
      'stt',
      'embedding',
    ]);
    assert.deepEqual(NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_IDS, [
      'vae',
      'clip',
      'lora',
      'controlnet',
      'auxiliary',
    ]);
    assert.deepEqual(NIMI_RUNTIME_LOCAL_ASSET_KIND_IDS, [
      'chat',
      'image',
      'video',
      'tts',
      'stt',
      'embedding',
      'vae',
      'clip',
      'lora',
      'controlnet',
      'auxiliary',
    ]);
    assert.deepEqual(NIMI_RUNTIME_LOCAL_ENGINE_IDS, ['llama', 'media', 'speech', 'sidecar']);
  });

  it('normalizes generated Runtime enums and request enum values', () => {
    assert.equal(parseNimiRuntimeLocalAssetKindId(LocalAssetKind.CONTROLNET), 'controlnet');
    assert.equal(parseNimiRuntimeLocalAssetKindId('LOCAL_ASSET_KIND_IMAGE'), 'image');
    assert.equal(toNimiRuntimeLocalAssetKindRequestValue('tts'), LocalAssetKind.TTS);
    assert.equal(parseNimiRuntimeLocalProfileEntryKindId(LocalProfileEntryKind.NODE), 'node');
    assert.equal(toNimiRuntimeLocalProfileEntryKindRequestValue('asset'), LocalProfileEntryKind.ASSET);
    assert.equal(parseNimiRuntimeLocalGpuMemoryModelId(GpuMemoryModel.UNIFIED), 'unified');
    assert.equal(toNimiRuntimeLocalGpuMemoryModelRequestValue('discrete'), GpuMemoryModel.DISCRETE);
    assert.equal(normalizeNimiRuntimeLocalEngineRuntimeModeId('LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED'), 'supervised');
    assert.equal(
      toNimiRuntimeLocalEngineRuntimeModeRequestValue('attached-endpoint'),
      LocalEngineRuntimeMode.ATTACHED_ENDPOINT,
    );
  });

  it('keeps runnable and passive asset declarations explicit', () => {
    assert.equal(isNimiRuntimeLocalRunnableAssetKindId('LOCAL_ASSET_KIND_STT'), true);
    assert.equal(normalizeNimiRuntimeLocalRunnableAssetKindId('LOCAL_ASSET_KIND_IMAGE'), 'image');
    assert.deepEqual(normalizeNimiRuntimeLocalAssetDeclaration({
      assetKind: 'LOCAL_ASSET_KIND_VIDEO',
      engine: ' media ',
    }), {
      assetKind: 'video',
      engine: 'media',
    });
    assert.deepEqual(normalizeNimiRuntimeLocalDependencyAssetDeclaration({
      assetKind: 'chat',
      engine: ' sidecar ',
    }), {
      assetKind: 'vae',
      engine: 'sidecar',
    });
    assert.equal(canImportNimiRuntimeLocalAssetDeclaration({ assetKind: 'auxiliary' }), false);
    assert.equal(canImportNimiRuntimeLocalAssetDeclaration({ assetKind: 'auxiliary', engine: 'sidecar' }), true);
  });

  it('formats and orders asset kinds without exposing numeric enum labels to UI', () => {
    assert.equal(formatNimiRuntimeLocalAssetKindLabel('LOCAL_ASSET_KIND_CONTROLNET'), 'ControlNet');
    assert.equal(compareNimiRuntimeLocalAssetKindForDisplay('image', 'controlnet') < 0, true);
  });

  it('maps canonical capabilities to runnable asset kinds', () => {
    assert.deepEqual(nimiRuntimeLocalCapabilitiesForAssetKind('embedding'), ['text.embed']);
    assert.deepEqual(nimiRuntimeLocalCapabilitiesForAssetKind('vae'), []);
    assert.equal(nimiRuntimeLocalRunnableAssetKindForCapabilities(['image.generate']), 'image');
    assert.equal(nimiRuntimeLocalRunnableAssetKindForCapabilities(['unknown'], 'chat'), 'chat');
  });
});
