import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runtimeRouteLocalKindForCapability,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModalityForCapability,
} from '../../src/ai/index.js';
import { LocalAssetKind } from '../../src/runtime/generated/runtime/v1/local_runtime_types.js';

test('runtime route local kind projection maps canonical capabilities to Runtime asset kind ids', () => {
  assert.equal(runtimeRouteLocalKindForCapability('text.generate'), 'chat');
  assert.equal(runtimeRouteLocalKindForCapability('text.embed'), 'embedding');
  assert.equal(runtimeRouteLocalKindForCapability('image.generate'), 'image');
  assert.equal(runtimeRouteLocalKindForCapability('video.generate'), 'video');
  assert.equal(runtimeRouteLocalKindForCapability('audio.synthesize'), 'tts');
  assert.equal(runtimeRouteLocalKindForCapability('voice_workflow.voice_clone'), 'tts');
  assert.equal(runtimeRouteLocalKindForCapability('voice_workflow.voice_design'), 'tts');
  assert.equal(runtimeRouteLocalKindForCapability('audio.transcribe'), 'stt');
  assert.equal(runtimeRouteLocalKindForCapability('world.generate'), null);
  assert.equal(runtimeRouteLocalKindForCapability('music.generate'), null);
});

test('runtime route modality projection preserves chat fallback for non-local capabilities', () => {
  assert.equal(runtimeRouteModalityForCapability('image.generate'), 'image');
  assert.equal(runtimeRouteModalityForCapability('world.generate'), 'chat');
  assert.equal(runtimeRouteModalityForCapability('music.generate'), 'chat');
});

test('runtime route local kind support accepts Runtime asset kind wire values', () => {
  assert.equal(runtimeRouteLocalKindSupportsCapability('LOCAL_ASSET_KIND_IMAGE', 'image.generate'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability(LocalAssetKind.TTS, 'audio.synthesize'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('embedding', 'text.embed'), true);
  assert.equal(runtimeRouteLocalKindSupportsCapability('vae', 'text.generate'), false);
  assert.equal(runtimeRouteLocalKindSupportsCapability('music', 'music.generate'), false);
});
