import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheSpeechArtifactsForDesktopPlayback } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-dependencies.js';

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

test('tts artifacts remain unchanged when desktop media cache is unavailable', async () => {
  const originalArtifact = {
    uri: '',
    mimeType: 'audio/mpeg',
    bytes: new Uint8Array([7, 8, 9]),
  } as never;

  const artifacts = await cacheSpeechArtifactsForDesktopPlayback({
    artifacts: [originalArtifact],
    audioFormat: 'mp3',
    mediaCachePut: async () => null,
  });

  assert.equal(artifacts[0]?.uri || '', '');
  assert.equal(artifacts[0]?.mimeType, 'audio/mpeg');
  assert.deepEqual(Array.from(artifacts[0]?.bytes || []), [7, 8, 9]);
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
