import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coerceNimiImageGenerationParams,
  coerceNimiSpeechTranscriptionParams,
  coerceNimiVideoGenerationParams,
  mimeTypeForNimiAudioUrl,
} from './index';

test('image generation parameters coerce runtime media fields and provider options', () => {
  const params = coerceNimiImageGenerationParams({
    size: '1024x768',
    response_format: 'b64_json',
    seed: '42',
    count: '2',
    timeout_ms: '15000',
    steps: '28',
    cfg_scale: '7.5',
    sampler: 'dpm++2m',
    scheduler: 'karras',
    reference_images: ['https://example.test/ref.png'],
  });

  assert.equal(params.size, '1024x768');
  assert.equal(params.responseFormat, 'b64_json');
  assert.equal(params.seed, '42');
  assert.equal(params.count, 2);
  assert.equal(params.timeoutMs, 15000);
  assert.deepEqual(params.referenceImages, ['https://example.test/ref.png']);
  assert.deepEqual(params.providerOptions, {
    steps: 28,
    cfgScale: 7.5,
    mode: 'dpmpp2m',
    scheduler: 'karras',
  });
});

test('image generation parameters reject unsupported sampler instead of dropping it', () => {
  assert.throws(
    () => coerceNimiImageGenerationParams({ sampler: 'surprise-me' }),
    /Generation parameter sampler is not supported/,
  );
});

test('video and transcription generation parameters coerce timeout and typed options', () => {
  const video = coerceNimiVideoGenerationParams({
    mode: 'i2v-reference',
    durationSec: '4.5',
    fps: '24',
    timeoutMs: '30000',
    generateAudio: true,
  });
  assert.equal(video.mode, 'i2v-reference');
  assert.deepEqual(video.options, {
    durationSec: 4.5,
    fps: 24,
    generateAudio: true,
  });
  assert.equal(video.timeoutMs, 30000);

  const transcription = coerceNimiSpeechTranscriptionParams({
    speakerCount: '2',
    timeoutMs: '45000',
    timestamps: true,
    diarization: false,
  });
  assert.equal(transcription.speakerCount, 2);
  assert.equal(transcription.timeoutMs, 45000);
  assert.equal(transcription.timestamps, true);
  assert.equal(transcription.diarization, false);
});

test('audio URL mime type prefers content type and falls back to file extension', () => {
  assert.equal(mimeTypeForNimiAudioUrl('https://example.test/audio.wav', 'audio/mpeg; charset=utf-8'), 'audio/mpeg');
  assert.equal(mimeTypeForNimiAudioUrl('https://example.test/audio.m4a'), 'audio/mp4');
  assert.equal(mimeTypeForNimiAudioUrl('https://example.test/audio.bin'), 'audio/wav');
});
