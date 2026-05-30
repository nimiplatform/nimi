import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_RUNTIME_ASSET_KIND_IDS,
  LOCAL_RUNTIME_ASSET_STATUS_IDS,
  LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS,
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  isLocalRuntimePassiveAssetKindId,
  isLocalRuntimeRunnableAssetKindId,
  localRuntimeCapabilitiesForAssetKind,
  localRuntimeRunnableAssetKindForCapabilities,
  normalizeLocalRuntimeAssetStatusId,
  normalizeLocalRuntimeAssetKindId,
  normalizeLocalRuntimeRunnableAssetKindId,
  parseLocalProfileEntryKindId,
  parseLocalRuntimeGpuMemoryModelId,
  parseLocalRuntimeAssetKindId,
  parseLocalRuntimeAssetStatusId,
  toLocalProfileEntryKindRequestValue,
  toLocalRuntimeAssetKindRequestValue,
  toLocalRuntimeAssetStatusRequestValue,
  toLocalRuntimeGpuMemoryModelRequestValue,
} from '../../src/runtime/index.js';
import {
  GpuMemoryModel,
  LocalAssetKind,
  LocalAssetStatus,
  LocalProfileEntryKind,
} from '../../src/runtime/generated/runtime/v1/local_runtime_types.js';

test('local runtime asset kind ids are projected from Runtime enum order', () => {
  assert.deepEqual(LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS, ['chat', 'image', 'video', 'tts', 'stt', 'embedding']);
  assert.deepEqual(LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS, ['vae', 'clip', 'lora', 'controlnet', 'auxiliary']);
  assert.deepEqual(LOCAL_RUNTIME_ASSET_KIND_IDS, [
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
  assert.deepEqual(LOCAL_RUNTIME_ASSET_STATUS_IDS, ['installed', 'active', 'unhealthy', 'removed']);
});

test('local runtime asset kind parser accepts Runtime wire names and values', () => {
  assert.equal(parseLocalRuntimeAssetKindId(LocalAssetKind.CHAT), 'chat');
  assert.equal(parseLocalRuntimeAssetKindId('LOCAL_ASSET_KIND_IMAGE'), 'image');
  assert.equal(parseLocalRuntimeAssetKindId('14'), 'auxiliary');
  assert.equal(parseLocalRuntimeAssetKindId('music'), undefined);
});

test('local runtime asset kind predicates and normalizers fail closed', () => {
  assert.equal(isLocalRuntimeRunnableAssetKindId('tts'), true);
  assert.equal(isLocalRuntimeRunnableAssetKindId('vae'), false);
  assert.equal(isLocalRuntimePassiveAssetKindId('vae'), true);
  assert.equal(isLocalRuntimePassiveAssetKindId('chat'), false);
  assert.equal(normalizeLocalRuntimeAssetKindId('LOCAL_ASSET_KIND_CONTROLNET'), 'controlnet');
  assert.equal(normalizeLocalRuntimeAssetKindId('music'), 'chat');
  assert.equal(normalizeLocalRuntimeRunnableAssetKindId('embedding'), 'embedding');
  assert.equal(normalizeLocalRuntimeRunnableAssetKindId('vae'), 'chat');
});

test('local runtime asset status parser accepts Runtime wire names and values', () => {
  assert.equal(parseLocalRuntimeAssetStatusId(LocalAssetStatus.ACTIVE), 'active');
  assert.equal(parseLocalRuntimeAssetStatusId('LOCAL_ASSET_STATUS_UNHEALTHY'), 'unhealthy');
  assert.equal(parseLocalRuntimeAssetStatusId('4'), 'removed');
  assert.equal(parseLocalRuntimeAssetStatusId('LOCAL_MODEL_STATUS_ACTIVE'), undefined);
  assert.equal(normalizeLocalRuntimeAssetStatusId('LOCAL_ASSET_STATUS_ACTIVE'), 'active');
  assert.equal(normalizeLocalRuntimeAssetStatusId('LOCAL_MODEL_STATUS_ACTIVE'), 'installed');
  assert.equal(toLocalRuntimeAssetStatusRequestValue('removed'), LocalAssetStatus.REMOVED);
  assert.equal(toLocalRuntimeAssetStatusRequestValue('missing'), LocalAssetStatus.UNSPECIFIED);
});

test('local runtime asset kind capability projection stays runtime-local', () => {
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('image'), ['image.generate']);
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('video'), ['video.generate']);
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('tts'), ['audio.synthesize']);
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('stt'), ['audio.transcribe']);
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('embedding'), ['text.embed']);
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('vae'), ['chat']);
  assert.equal(localRuntimeRunnableAssetKindForCapabilities(['image']), 'image');
  assert.equal(localRuntimeRunnableAssetKindForCapabilities(['text.embed']), 'embedding');
  assert.equal(localRuntimeRunnableAssetKindForCapabilities(['audio.synthesize']), 'tts');
  assert.equal(localRuntimeRunnableAssetKindForCapabilities(['unknown']), 'chat');
});

test('local runtime write-side enum helpers return Runtime proto enum values', () => {
  assert.equal(toLocalRuntimeAssetKindRequestValue('LOCAL_ASSET_KIND_TTS'), LocalAssetKind.TTS);
  assert.equal(toLocalRuntimeAssetKindRequestValue('music'), LocalAssetKind.UNSPECIFIED);
  assert.equal(parseLocalProfileEntryKindId(LocalProfileEntryKind.SERVICE), 'service');
  assert.equal(parseLocalProfileEntryKindId('LOCAL_PROFILE_ENTRY_KIND_ASSET'), 'asset');
  assert.equal(toLocalProfileEntryKindRequestValue('node'), LocalProfileEntryKind.NODE);
  assert.equal(toLocalProfileEntryKindRequestValue('model'), LocalProfileEntryKind.UNSPECIFIED);
  assert.equal(parseLocalRuntimeGpuMemoryModelId(GpuMemoryModel.UNIFIED), 'unified');
  assert.equal(parseLocalRuntimeGpuMemoryModelId('GPU_MEMORY_MODEL_DISCRETE'), 'discrete');
  assert.equal(toLocalRuntimeGpuMemoryModelRequestValue('discrete'), GpuMemoryModel.DISCRETE);
  assert.equal(toLocalRuntimeGpuMemoryModelRequestValue('shared'), GpuMemoryModel.UNSPECIFIED);
});
