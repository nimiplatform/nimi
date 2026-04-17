import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
} from '../../src/runtime/generated/runtime/v1/ai.js';
import {
  buildMusicIterationExtensions,
  runtimeBuildSubmitScenarioJobRequestForMedia,
} from '../../src/runtime/runtime-media.js';
import { createMockContext } from './runtime-media-test-helpers.js';

test('build request: image modal with all optional fields', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'draw a cat',
      negativePrompt: 'bad quality',
      n: 2,
      size: '1024x1024',
      aspectRatio: '16:9',
      quality: 'hd',
      style: 'vivid',
      seed: 42,
      referenceImages: ['ref1.png', 'ref2.png'],
      mask: 'mask.png',
      responseFormat: 'url' as const,
      route: 'local' as const,
      timeoutMs: 5000,
      requestId: 'req-1',
      idempotencyKey: 'idem-1',
      labels: { env: 'test' },
      extensions: { custom: true },
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'imageGenerate');
  if (result.spec?.spec.oneofKind === 'imageGenerate') {
    assert.equal(result.spec.spec.imageGenerate.prompt, 'draw a cat');
    assert.equal(result.spec.spec.imageGenerate.negativePrompt, 'bad quality');
    assert.equal(result.spec.spec.imageGenerate.n, 2);
    assert.equal(result.spec.spec.imageGenerate.size, '1024x1024');
    assert.equal(result.spec.spec.imageGenerate.aspectRatio, '16:9');
    assert.equal(result.spec.spec.imageGenerate.quality, 'hd');
    assert.equal(result.spec.spec.imageGenerate.style, 'vivid');
    assert.equal(result.spec.spec.imageGenerate.seed, '42');
    assert.deepEqual(result.spec.spec.imageGenerate.referenceImages, ['ref1.png', 'ref2.png']);
    assert.equal(result.spec.spec.imageGenerate.mask, 'mask.png');
    assert.equal(result.spec.spec.imageGenerate.responseFormat, 'url');
  }
});

test('build request: image modal with missing optional fields (defaults)', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'draw something',
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'imageGenerate');
  if (result.spec?.spec.oneofKind === 'imageGenerate') {
    assert.equal(result.spec.spec.imageGenerate.n, 0);
    assert.equal(result.spec.spec.imageGenerate.seed, '0');
    assert.deepEqual(result.spec.spec.imageGenerate.referenceImages, []);
  }
});

test('build request: image modal with referenceImages as non-array', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      referenceImages: 'not-an-array' as never,
    },
  });

  if (result.spec?.spec.oneofKind === 'imageGenerate') {
    assert.deepEqual(result.spec.spec.imageGenerate.referenceImages, []);
  }
});

test('build request: video modal with text content', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 't2v' as const,
      content: [
        { type: 'text' as const, text: 'a cat walking' },
      ],
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'videoGenerate');
  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.equal(result.spec.spec.videoGenerate.mode, VideoMode.T2V);
    assert.equal(result.spec.spec.videoGenerate.content.length, 1);
    assert.equal(result.spec.spec.videoGenerate.content[0]?.type, VideoContentType.TEXT);
    assert.equal(result.spec.spec.videoGenerate.content[0]?.role, VideoContentRole.PROMPT);
  }
});

test('build request: video modal with image_url content', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 'i2v-first-frame' as const,
      content: [
        { type: 'image_url' as const, role: 'first_frame' as const, imageUrl: 'https://example.com/img.png' },
      ],
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.equal(result.spec.spec.videoGenerate.mode, VideoMode.I2V_FIRST_FRAME);
    assert.equal(result.spec.spec.videoGenerate.content[0]?.type, VideoContentType.IMAGE_URL);
    assert.equal(result.spec.spec.videoGenerate.content[0]?.role, VideoContentRole.FIRST_FRAME);
    assert.equal(result.spec.spec.videoGenerate.content[0]?.text, '');
  }
});

test('build request: video modal with i2v-first-last mode', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 'i2v-first-last' as const,
      content: [
        { type: 'image_url' as const, role: 'last_frame' as const, imageUrl: 'https://example.com/last.png' },
      ],
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.equal(result.spec.spec.videoGenerate.mode, VideoMode.I2V_FIRST_LAST);
    assert.equal(result.spec.spec.videoGenerate.content[0]?.role, VideoContentRole.LAST_FRAME);
  }
});

test('build request: video modal with i2v-reference mode and reference_image role', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 'i2v-reference' as const,
      content: [
        { type: 'image_url' as const, role: 'reference_image' as const, imageUrl: 'https://example.com/ref.png' },
      ],
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.equal(result.spec.spec.videoGenerate.mode, VideoMode.I2V_REFERENCE);
    assert.equal(result.spec.spec.videoGenerate.content[0]?.role, VideoContentRole.REFERENCE_IMAGE);
  }
});

test('build request: video modal with unrecognized mode defaults to UNSPECIFIED', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 'unknown-mode' as never,
      content: [],
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.equal(result.spec.spec.videoGenerate.mode, VideoMode.UNSPECIFIED);
  }
});

test('build request: video modal with content as non-array', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 't2v' as const,
      content: 'not-an-array' as never,
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.deepEqual(result.spec.spec.videoGenerate.content, []);
  }
});

test('build request: video modal with full options object', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 't2v' as const,
      content: [],
      options: {
        resolution: '1080p',
        ratio: '16:9',
        durationSec: 10,
        frames: 120,
        fps: 24,
        seed: 7,
        cameraFixed: true,
        watermark: false,
        generateAudio: true,
        draft: false,
        serviceTier: 'premium',
        executionExpiresAfterSec: 600,
        returnLastFrame: true,
      },
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    const opts = result.spec.spec.videoGenerate.options;
    assert.ok(opts);
    assert.equal(opts.resolution, '1080p');
    assert.equal(opts.ratio, '16:9');
    assert.equal(opts.durationSec, 10);
    assert.equal(opts.frames, 120);
    assert.equal(opts.fps, 24);
    assert.equal(opts.seed, '7');
    assert.equal(opts.cameraFixed, true);
    assert.equal(opts.watermark, false);
    assert.equal(opts.generateAudio, true);
    assert.equal(opts.draft, false);
    assert.equal(opts.serviceTier, 'premium');
    assert.equal(opts.executionExpiresAfterSec, 600);
    assert.equal(opts.returnLastFrame, true);
  }
});

test('build request: video modal without options defaults', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 't2v' as const,
      content: [],
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    const opts = result.spec.spec.videoGenerate.options;
    assert.ok(opts);
    assert.equal(opts.durationSec, 0);
    assert.equal(opts.frames, 0);
    assert.equal(opts.fps, 0);
    assert.equal(opts.seed, '0');
    assert.equal(opts.cameraFixed, false);
    assert.equal(opts.watermark, false);
  }
});

test('build request: world modal with text prompt and image conditioning', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'world',
    input: {
      model: 'marble-1.1',
      displayName: 'City Street',
      textPrompt: 'A rainy neon city street at dusk.',
      tags: ['city', 'rain'],
      seed: 77,
      conditioning: {
        type: 'image',
        content: {
          kind: 'uri',
          uri: 'https://example.com/ref.png',
        },
      },
      extensions: { quality: 'preview' },
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'worldGenerate');
  if (result.spec?.spec.oneofKind === 'worldGenerate') {
    assert.equal(result.spec.spec.worldGenerate.displayName, 'City Street');
    assert.equal(result.spec.spec.worldGenerate.textPrompt, 'A rainy neon city street at dusk.');
    assert.deepEqual(result.spec.spec.worldGenerate.tags, ['city', 'rain']);
    assert.equal(result.spec.spec.worldGenerate.seed, '77');
    assert.equal(result.spec.spec.worldGenerate.conditioning.oneofKind, 'imagePrompt');
    if (result.spec.spec.worldGenerate.conditioning.oneofKind === 'imagePrompt') {
      assert.equal(
        result.spec.spec.worldGenerate.conditioning.imagePrompt.content?.source.oneofKind,
        'uri',
      );
      assert.equal(
        result.spec.spec.worldGenerate.conditioning.imagePrompt.content?.source.uri,
        'https://example.com/ref.png',
      );
    }
  }
});

test('build request: world modal with multi-image conditioning and media asset refs', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'world',
    input: {
      model: 'marble-1.1-plus',
      conditioning: {
        type: 'multi-image',
        images: [
          {
            content: {
              kind: 'media_asset_id',
              mediaAssetId: 'asset-1',
            },
          },
          {
            content: {
              kind: 'uri',
              uri: 'https://example.com/second.png',
            },
          },
        ],
      },
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'worldGenerate');
  if (result.spec?.spec.oneofKind === 'worldGenerate') {
    assert.equal(result.spec.spec.worldGenerate.conditioning.oneofKind, 'multiImagePrompt');
    if (result.spec.spec.worldGenerate.conditioning.oneofKind === 'multiImagePrompt') {
      assert.equal(result.spec.spec.worldGenerate.conditioning.multiImagePrompt.images.length, 2);
      assert.equal(
        result.spec.spec.worldGenerate.conditioning.multiImagePrompt.images[0]?.content?.source.oneofKind,
        'mediaAssetId',
      );
      assert.equal(
        result.spec.spec.worldGenerate.conditioning.multiImagePrompt.images[0]?.content?.source.mediaAssetId,
        'asset-1',
      );
    }
  }
});

test('build request: video text content defaults role to prompt when omitted', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 't2v' as const,
      content: [
        { type: 'text' as const, text: 'hello' },
      ],
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.equal(result.spec.spec.videoGenerate.content[0]?.role, VideoContentRole.PROMPT);
  }
});

test('build request: tts modal with all options including voiceRenderHints', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'hello world',
      voice: 'nova',
      language: 'en',
      audioFormat: 'mp3',
      sampleRateHz: 44100,
      speed: 1.5,
      pitch: 0.8,
      volume: 0.9,
      emotion: 'happy',
      timingMode: 'word' as const,
      voiceRenderHints: {
        stability: 0.5,
        similarityBoost: 0.7,
        style: 0.3,
        useSpeakerBoost: true,
        speed: 1.2,
      },
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'speechSynthesize');
  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    const spec = result.spec.spec.speechSynthesize;
    assert.equal(spec.text, 'hello world');
    assert.equal(spec.language, 'en');
    assert.equal(spec.audioFormat, 'mp3');
    assert.equal(spec.sampleRateHz, 44100);
    assert.equal(spec.speed, 1.5);
    assert.equal(spec.pitch, 0.8);
    assert.equal(spec.volume, 0.9);
    assert.equal(spec.emotion, 'happy');
    assert.equal(spec.timingMode, SpeechTimingMode.WORD);
    assert.ok(spec.voiceRef);
    assert.equal(spec.voiceRef.kind, 3);
    assert.ok(spec.voiceRenderHints);
    assert.equal(spec.voiceRenderHints.stability, 0.5);
    assert.equal(spec.voiceRenderHints.similarityBoost, 0.7);
    assert.equal(spec.voiceRenderHints.style, 0.3);
    assert.equal(spec.voiceRenderHints.useSpeakerBoost, true);
    assert.equal(spec.voiceRenderHints.speed, 1.2);
  }
});

test('build request: tts modal without voiceRenderHints', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'simple text',
    },
  });

  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.equal(result.spec.spec.speechSynthesize.voiceRenderHints, undefined);
  }
});

test('build request: tts modal without voice returns undefined voiceRef', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'no voice',
    },
  });

  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.equal(result.spec.spec.speechSynthesize.voiceRef, undefined);
  }
});

test('build request: tts modal with empty voice returns undefined voiceRef', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'empty voice',
      voice: '  ',
    },
  });

  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.equal(result.spec.spec.speechSynthesize.voiceRef, undefined);
  }
});

test('build request: tts with timing mode "char"', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'char timing',
      timingMode: 'char' as const,
    },
  });

  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.equal(result.spec.spec.speechSynthesize.timingMode, SpeechTimingMode.CHAR);
  }
});

test('build request: tts with timing mode "none"', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'no timing',
      timingMode: 'none' as const,
    },
  });

  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.equal(result.spec.spec.speechSynthesize.timingMode, SpeechTimingMode.NONE);
  }
});

test('build request: tts without timing mode defaults to UNSPECIFIED', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'default timing',
    },
  });

  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.equal(result.spec.spec.speechSynthesize.timingMode, SpeechTimingMode.UNSPECIFIED);
  }
});

test('build request: tts with voiceRenderHints missing optional fields', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'partial hints',
      voiceRenderHints: {},
    },
  });

  if (result.spec?.spec.oneofKind === 'speechSynthesize') {
    assert.ok(result.spec.spec.speechSynthesize.voiceRenderHints);
    assert.equal(result.spec.spec.speechSynthesize.voiceRenderHints.stability, 0);
    assert.equal(result.spec.spec.speechSynthesize.voiceRenderHints.similarityBoost, 0);
    assert.equal(result.spec.spec.speechSynthesize.voiceRenderHints.useSpeakerBoost, false);
    assert.equal(result.spec.spec.speechSynthesize.voiceRenderHints.speed, 0);
  }
});

test('build request: stt modal with audio bytes', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: {
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
      mimeType: 'audio/wav',
      language: 'en',
      timestamps: true,
      diarization: true,
      speakerCount: 2,
      prompt: 'meeting transcript',
      responseFormat: 'json',
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'speechTranscribe');
  if (result.spec?.spec.oneofKind === 'speechTranscribe') {
    const spec = result.spec.spec.speechTranscribe;
    assert.equal(spec.audioSource?.source.oneofKind, 'audioBytes');
    assert.equal(spec.mimeType, 'audio/wav');
    assert.equal(spec.language, 'en');
    assert.equal(spec.timestamps, true);
    assert.equal(spec.diarization, true);
    assert.equal(spec.speakerCount, 2);
    assert.equal(spec.prompt, 'meeting transcript');
    assert.equal(spec.responseFormat, 'json');
  }
});

test('build request: music modal maps canonical iteration extension namespace', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'music',
    input: {
      model: 'suno-v4',
      prompt: 'continue this song',
      title: 'Continuation',
      extensions: buildMusicIterationExtensions({
        mode: 'reference',
        sourceAudioBase64: 'aGVsbG8=',
        sourceMimeType: 'audio/wav',
      }),
    },
  });

  assert.equal(result.spec?.spec.oneofKind, 'musicGenerate');
  assert.equal(result.extensions.length, 1);
  assert.equal(result.extensions[0]?.namespace, 'nimi.scenario.music_generate.request');
  const fields = result.extensions[0]?.payload?.fields ?? {};
  assert.equal(fields.mode?.kind.oneofKind, 'stringValue');
  assert.equal(fields.mode?.kind.stringValue, 'reference');
  assert.equal(fields.source_audio_base64?.kind.oneofKind, 'stringValue');
  assert.equal(fields.source_audio_base64?.kind.stringValue, 'aGVsbG8=');
});

test('build request: stt modal with audio url', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: {
      model: 'stt-model',
      audio: { kind: 'url', url: 'https://example.com/audio.wav' },
      mimeType: 'audio/wav',
    },
  });

  if (result.spec?.spec.oneofKind === 'speechTranscribe') {
    assert.equal(result.spec.spec.speechTranscribe.audioSource?.source.oneofKind, 'audioUri');
  }
});

test('build request: stt modal with audio chunks', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: {
      model: 'stt-model',
      audio: { kind: 'chunks', chunks: [new Uint8Array([7, 8])] },
      mimeType: 'audio/wav',
    },
  });

  if (result.spec?.spec.oneofKind === 'speechTranscribe') {
    assert.equal(result.spec.spec.speechTranscribe.audioSource?.source.oneofKind, 'audioChunks');
  }
});

test('build request: stt modal without mimeType now fails closed', async () => {
  const ctx = createMockContext();
  await assert.rejects(
    async () => runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
      modal: 'stt',
      input: {
        model: 'stt-model',
        audio: { kind: 'bytes', bytes: new Uint8Array([]) },
      },
    }),
    /mimeType is required/,
  );
});

test('build request: stt modal without optional fields defaults to false/0', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: {
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: new Uint8Array([]) },
      mimeType: 'audio/wav',
    },
  });

  if (result.spec?.spec.oneofKind === 'speechTranscribe') {
    assert.equal(result.spec.spec.speechTranscribe.timestamps, false);
    assert.equal(result.spec.spec.speechTranscribe.diarization, false);
    assert.equal(result.spec.spec.speechTranscribe.speakerCount, 0);
  }
});

test('build request: timeoutMs from input takes precedence over ctx.options', async () => {
  const ctx = createMockContext({ timeoutMs: 3000 });
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      timeoutMs: 7000,
    },
  });

  assert.equal(result.head?.timeoutMs, 7000);
});

test('build request: timeoutMs falls back to ctx.options.timeoutMs', async () => {
  const ctx = createMockContext({ timeoutMs: 3000 });
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
    },
  });

  assert.equal(result.head?.timeoutMs, 3000);
});

test('build request: timeoutMs defaults to 0 when neither set', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
    },
  });

  assert.equal(result.head?.timeoutMs, 0);
});

test('build request: cloud route triggers resolveSubjectUserId', async () => {
  let resolvedSubject = false;
  const ctx = createMockContext({
    resolveSubjectUserId: async () => {
      resolvedSubject = true;
      return 'cloud-subject';
    },
  });

  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      route: 'cloud',
    },
  });

  assert.equal(resolvedSubject, true);
  assert.equal(result.head?.subjectUserId, 'cloud-subject');
});

test('build request: local route without connectorId triggers resolveOptionalSubjectUserId', async () => {
  let resolvedOptional = false;
  const ctx = createMockContext({
    resolveOptionalSubjectUserId: async () => {
      resolvedOptional = true;
      return undefined;
    },
  });

  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      route: 'local',
    },
  });

  assert.equal(resolvedOptional, true);
  assert.equal(result.head?.subjectUserId, '');
});

test('build request: connectorId triggers required subject resolution', async () => {
  const ctx = createMockContext({
    resolveSubjectUserId: async () => 'connector-subject',
  });

  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      connectorId: 'my-connector',
    },
  });

  assert.equal(result.head?.subjectUserId, 'connector-subject');
  assert.equal(result.head?.connectorId, 'my-connector');
});

test('build request: extensions are converted to ScenarioExtension', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      extensions: { workflow: 'custom', steps: 20 },
    },
  });

  assert.equal(result.extensions.length, 1);
  assert.equal(result.extensions[0]?.namespace, 'nimi.scenario.image.request');
});

test('build request: empty extensions produces empty array', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      extensions: {},
    },
  });

  assert.equal(result.extensions.length, 0);
});

test('build request: undefined extensions produces empty array', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
    },
  });

  assert.equal(result.extensions.length, 0);
});

test('build request: video modal extensions use correct namespace', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 't2v' as const,
      content: [],
      extensions: { extra: 'data' },
    },
  });

  assert.equal(result.extensions[0]?.namespace, 'nimi.scenario.video.request');
});

test('build request: tts modal extensions use correct namespace', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: {
      model: 'tts-model',
      text: 'test',
      extensions: { extra: 'data' },
    },
  });

  assert.equal(result.extensions[0]?.namespace, 'nimi.scenario.speech_synthesize.request');
});

test('build request: stt modal extensions use correct namespace', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: {
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: new Uint8Array([]) },
      mimeType: 'audio/wav',
      extensions: { extra: 'data' },
    },
  });

  assert.equal(result.extensions[0]?.namespace, 'nimi.scenario.speech_transcribe.request');
});

test('build request: labels are normalized', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      labels: { '  env  ': '  prod  ', '': 'ignored', valid: '' },
    },
  });

  assert.deepEqual(result.labels, { env: 'prod' });
});

test('build request: metadata passed to input.input.metadata', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      metadata: { 'x-custom': 'value' },
    },
  });

  assert.ok(result.head);
});

test('build request: metadata with keySource managed triggers required subject', async () => {
  let requiredResolved = false;
  const ctx = createMockContext({
    resolveSubjectUserId: async () => {
      requiredResolved = true;
      return 'managed-subject';
    },
  });

  await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      route: 'local',
      metadata: { keySource: 'managed' },
    },
  });

  assert.equal(requiredResolved, true);
});

test('build request: image modal maps to IMAGE_GENERATE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: { model: 'm', prompt: 'p' },
  });
  assert.equal(result.scenarioType, 3);
});

test('build request: video modal maps to VIDEO_GENERATE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: { model: 'm', mode: 't2v' as const, content: [] },
  });
  assert.equal(result.scenarioType, 4);
});

test('build request: tts modal maps to SPEECH_SYNTHESIZE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: { model: 'm', text: 't' },
  });
  assert.equal(result.scenarioType, 5);
});

test('build request: stt modal maps to SPEECH_TRANSCRIBE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: { model: 'm', audio: { kind: 'bytes', bytes: new Uint8Array([]) }, mimeType: 'audio/wav' },
  });
  assert.equal(result.scenarioType, 6);
});

test('build request: music modal maps to MUSIC_GENERATE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'music',
    input: { model: 'm', prompt: 'p' },
  });
  assert.equal(result.scenarioType, 9);
});

test('build request: video content role defaults to UNSPECIFIED for unknown role', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: {
      model: 'vid-model',
      mode: 't2v' as const,
      content: [
        { type: 'image_url' as const, role: 'unknown_role' as never, imageUrl: 'http://x.com/a.png' },
      ],
    },
  });

  if (result.spec?.spec.oneofKind === 'videoGenerate') {
    assert.equal(result.spec.spec.videoGenerate.content[0]?.role, VideoContentRole.UNSPECIFIED);
  }
});

test('build request: explicit subjectUserId passed to input is forwarded', async () => {
  const ctx = createMockContext({
    resolveSubjectUserId: async (explicit) => explicit || 'default-subject',
  });

  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: {
      model: 'img-model',
      prompt: 'test',
      route: 'cloud',
      subjectUserId: 'explicit-user',
    },
  });

  assert.equal(result.head?.subjectUserId, 'explicit-user');
});
