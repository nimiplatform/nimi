import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GpuMemoryModel,
  LocalAssetKind,
  LocalEngineRuntimeMode,
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
  toNimiRuntimeLocalAssetKindRequestValue,
  toNimiRuntimeLocalEngineRuntimeModeRequestValue,
  toNimiRuntimeLocalGpuMemoryModelRequestValue,
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
    assert.equal(parseNimiRuntimeLocalGpuMemoryModelId(GpuMemoryModel.UNIFIED), 'unified');
    assert.equal(toNimiRuntimeLocalGpuMemoryModelRequestValue('discrete'), GpuMemoryModel.DISCRETE);
    assert.equal(normalizeNimiRuntimeLocalEngineRuntimeModeId('LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED'), 'supervised');
    assert.equal(
      toNimiRuntimeLocalEngineRuntimeModeRequestValue('attached-endpoint'),
      LocalEngineRuntimeMode.ATTACHED_ENDPOINT,
    );
  });

  it('keeps local asset import declarations engine-free', () => {
    assert.equal(isNimiRuntimeLocalRunnableAssetKindId('LOCAL_ASSET_KIND_STT'), true);
    assert.equal(normalizeNimiRuntimeLocalRunnableAssetKindId('LOCAL_ASSET_KIND_IMAGE'), 'image');
    assert.deepEqual(normalizeNimiRuntimeLocalAssetDeclaration({
      assetKind: 'LOCAL_ASSET_KIND_VIDEO',
    }), {
      assetKind: 'video',
    });
    assert.deepEqual(normalizeNimiRuntimeLocalDependencyAssetDeclaration({
      assetKind: 'chat',
    }), {
      assetKind: 'vae',
    });
    assert.throws(() => normalizeNimiRuntimeLocalDependencyAssetDeclaration({
      assetKind: 'vae',
      engine: 'sidecar',
    } as never), /must not include engine/u);
    assert.throws(() => normalizeNimiRuntimeLocalAssetDeclaration({
      assetKind: 'image',
      engine: 'media',
    } as never), /must not include engine/u);
    assert.throws(() => normalizeNimiRuntimeLocalAssetDeclaration({
      assetKind: 'auxiliary',
      engine: 'media',
    } as never), /must not include engine/u);
    assert.equal(canImportNimiRuntimeLocalAssetDeclaration({ assetKind: 'image' }), true);
    assert.equal(canImportNimiRuntimeLocalAssetDeclaration({ assetKind: 'auxiliary' }), true);
    assert.equal(canImportNimiRuntimeLocalAssetDeclaration({ assetKind: 'image', engine: 'media' } as never), false);
    assert.equal(canImportNimiRuntimeLocalAssetDeclaration({ assetKind: 'auxiliary', engine: 'sidecar' } as never), false);
    assert.equal(canImportNimiRuntimeLocalAssetDeclaration({ assetKind: 'vae', engine: '' } as never), false);
  });

  it('formats and orders asset kinds without exposing numeric enum labels to UI', () => {
    assert.equal(formatNimiRuntimeLocalAssetKindLabel('LOCAL_ASSET_KIND_CONTROLNET'), 'ControlNet');
    assert.equal(compareNimiRuntimeLocalAssetKindForDisplay('image', 'controlnet') < 0, true);
  });

  it('maps canonical capabilities to runnable asset kinds', () => {
    assert.deepEqual(nimiRuntimeLocalCapabilitiesForAssetKind('embedding'), ['text.embed']);
    assert.deepEqual(nimiRuntimeLocalCapabilitiesForAssetKind('vae'), []);
    assert.equal(nimiRuntimeLocalRunnableAssetKindForCapabilities(['image.generate']), 'image');
    assert.equal(nimiRuntimeLocalRunnableAssetKindForCapabilities(['unknown']), undefined);
    assert.equal(nimiRuntimeLocalRunnableAssetKindForCapabilities(['text.generate', 'text.embed']), undefined);
    assert.equal(nimiRuntimeLocalRunnableAssetKindForCapabilities(['vision']), undefined);
  });
});
