import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheSpeechArtifactsForDesktopPlayback } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-profiles.js';

test('tts artifacts with bytes are cached to stable local uri for mod playback', async () => {
  const cacheCalls: Array<Record<string, unknown>> = [];
  const artifacts = await cacheSpeechArtifactsForDesktopPlayback({
    artifacts: [{
      uri: '',
      mimeType: 'audio/mpeg',
      bytes: new Uint8Array([1, 2, 3, 4]),
    }] as never,
    audioFormat: 'mp3',
    mediaCachePut: async (input) => {
      cacheCalls.push(input as Record<string, unknown>);
      return {
        cacheKey: 'cache-voice-1',
        filePath: '/tmp/cache-voice-1.mp3',
        uri: 'file:///tmp/cache-voice-1.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 4,
        existed: false,
      };
    },
  });

  assert.equal(cacheCalls.length, 1);
  assert.equal(cacheCalls[0]?.mimeType, 'audio/mpeg');
  assert.equal(cacheCalls[0]?.extensionHint, 'mp3');
  assert.equal(typeof cacheCalls[0]?.mediaBase64, 'string');
  assert.equal(artifacts[0]?.uri, 'file:///tmp/cache-voice-1.mp3');
  assert.equal(artifacts[0]?.mimeType, 'audio/mpeg');
  assert.deepEqual(Array.from(artifacts[0]?.bytes || []), [1, 2, 3, 4]);
});

test('tts artifacts fail-close when desktop media cache write fails', async () => {
  await assert.rejects(async () => cacheSpeechArtifactsForDesktopPlayback({
    artifacts: [{
      uri: '',
      mimeType: 'audio/mpeg',
      bytes: new Uint8Array([7, 8, 9]),
    }] as never,
    audioFormat: 'mp3',
    mediaCachePut: async () => {
      throw new Error('RUNTIME_MOD_MEDIA_CACHE_UNAVAILABLE');
    },
  }), /RUNTIME_MOD_MEDIA_CACHE_UNAVAILABLE/);
});

test('tts artifacts fail-close when audio bytes are present but mimeType is missing', async () => {
  await assert.rejects(async () => cacheSpeechArtifactsForDesktopPlayback({
    artifacts: [{
      uri: '',
      mimeType: '',
      bytes: new Uint8Array([7, 8, 9]),
    }] as never,
    audioFormat: 'mp3',
    mediaCachePut: async () => ({
      cacheKey: 'cache-voice-2',
      filePath: '/tmp/cache-voice-2.mp3',
      uri: 'file:///tmp/cache-voice-2.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 3,
      existed: false,
    }),
  }), /RUNTIME_MOD_MEDIA_CACHE_MIME_TYPE_REQUIRED/);
});

test('tts artifacts normalize audio/x-wav to audio/wav for renderer playback', async () => {
  const artifacts = await cacheSpeechArtifactsForDesktopPlayback({
    artifacts: [{
      uri: '',
      mimeType: 'audio/x-wav',
      bytes: new Uint8Array([82, 73, 70, 70]),
    }] as never,
    audioFormat: 'wav',
    mediaCachePut: async (input) => ({
      cacheKey: 'cache-voice-wav',
      filePath: '/tmp/cache-voice-wav.wav',
      uri: 'file:///tmp/cache-voice-wav.wav',
      mimeType: String((input as { mimeType?: string }).mimeType || ''),
      sizeBytes: 4,
      existed: false,
    }),
  });

  assert.equal(artifacts[0]?.mimeType, 'audio/wav');
});
