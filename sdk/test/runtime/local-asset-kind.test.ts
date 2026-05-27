import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_RUNTIME_ASSET_KIND_IDS,
  LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS,
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  isLocalRuntimePassiveAssetKindId,
  isLocalRuntimeRunnableAssetKindId,
  localRuntimeCapabilitiesForAssetKind,
  normalizeLocalRuntimeAssetKindId,
  normalizeLocalRuntimeRunnableAssetKindId,
  parseLocalRuntimeAssetKindId,
} from '../../src/runtime/index.js';
import { LocalAssetKind } from '../../src/runtime/generated/runtime/v1/local_runtime_types.js';

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

test('local runtime asset kind capability projection stays runtime-local', () => {
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('image'), ['image']);
  assert.deepEqual(localRuntimeCapabilitiesForAssetKind('vae'), ['chat']);
});
