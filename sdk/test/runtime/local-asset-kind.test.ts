import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_RUNTIME_ASSET_KIND_IDS,
  LOCAL_RUNTIME_ASSET_KIND_LABELS,
  LOCAL_RUNTIME_ASSET_STATUS_IDS,
  LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS,
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  canImportLocalRuntimeAssetDeclaration,
  compareLocalRuntimeAssetKindForDisplay,
  formatLocalRuntimeAssetKindLabel,
  isLocalRuntimePassiveAssetKindId,
  isLocalRuntimeRunnableAssetKindId,
  localRuntimeCapabilitiesForAssetKind,
  localRuntimeRunnableAssetKindForCapabilities,
  normalizeLocalRuntimeAssetDeclaration,
  normalizeLocalRuntimeAssetStatusId,
  normalizeLocalRuntimeAssetKindId,
  normalizeLocalRuntimeDependencyAssetDeclaration,
  normalizeLocalRuntimePassiveAssetKindId,
  normalizeLocalRuntimeRunnableAssetKindId,
  parseLocalProfileEntryKindId,
  parseLocalRuntimeGpuMemoryModelId,
  parseLocalRuntimeAssetKindId,
  parseLocalRuntimeAssetStatusId,
  toCanonicalLocalRuntimeAssetId,
  toCanonicalLocalRuntimeAssetLookupKey,
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
  assert.equal(normalizeLocalRuntimePassiveAssetKindId('lora'), 'lora');
  assert.equal(normalizeLocalRuntimePassiveAssetKindId('chat'), 'vae');
  assert.equal(normalizeLocalRuntimeRunnableAssetKindId('embedding'), 'embedding');
  assert.equal(normalizeLocalRuntimeRunnableAssetKindId('vae'), 'chat');
});

test('local runtime asset kind DX helpers stay in the SDK projection', () => {
  assert.equal(LOCAL_RUNTIME_ASSET_KIND_LABELS.controlnet, 'ControlNet');
  assert.equal(formatLocalRuntimeAssetKindLabel('LOCAL_ASSET_KIND_TTS'), 'TTS');
  assert.equal(formatLocalRuntimeAssetKindLabel('unknown-kind'), 'unknown-kind');
  assert.deepEqual(
    ['lora', 'chat', 'auxiliary', 'image'].sort(compareLocalRuntimeAssetKindForDisplay),
    ['chat', 'image', 'lora', 'auxiliary'],
  );
  assert.deepEqual(
    normalizeLocalRuntimeAssetDeclaration({ assetKind: 'LOCAL_ASSET_KIND_IMAGE', engine: ' media ' }),
    { assetKind: 'image', engine: 'media' },
  );
  assert.deepEqual(
    normalizeLocalRuntimeDependencyAssetDeclaration({ assetKind: 'chat', engine: ' sidecar ' }),
    { assetKind: 'vae', engine: 'sidecar' },
  );
  assert.equal(canImportLocalRuntimeAssetDeclaration({ assetKind: 'auxiliary' }), false);
  assert.equal(canImportLocalRuntimeAssetDeclaration({ assetKind: 'auxiliary', engine: 'sidecar' }), true);
  assert.equal(canImportLocalRuntimeAssetDeclaration({ assetKind: 'chat' }), true);
  assert.equal(canImportLocalRuntimeAssetDeclaration({ assetKind: 'missing' }), false);
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

test('local runtime asset id projection normalizes admitted local aliases', () => {
  assert.equal(toCanonicalLocalRuntimeAssetId('gemma/model'), 'local/gemma/model');
  assert.equal(toCanonicalLocalRuntimeAssetId('local/gemma/model'), 'local/gemma/model');
  assert.equal(toCanonicalLocalRuntimeAssetId('llama/gemma/model'), 'local/gemma/model');
  assert.equal(toCanonicalLocalRuntimeAssetId('media/sdxl'), 'local/sdxl');
  assert.equal(toCanonicalLocalRuntimeAssetId('speech/voice'), 'local/voice');
  assert.equal(toCanonicalLocalRuntimeAssetId('sidecar/embedding'), 'local/embedding');
  assert.equal(toCanonicalLocalRuntimeAssetId(''), '');
  assert.equal(toCanonicalLocalRuntimeAssetLookupKey('LOCAL/Gemma/Model'), 'local/gemma/model');
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
