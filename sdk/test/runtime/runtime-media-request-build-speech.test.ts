import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
} from '../../src/runtime/generated/runtime/v1/ai.js';
import { VoiceReferenceKind } from '../../src/runtime/generated/runtime/v1/voice.js';
import {
  buildMusicIterationExtensions,
  runtimeBuildSubmitScenarioJobRequestForMedia,
} from '../../src/runtime/runtime-media.js';
import { createMockContext } from './runtime-media-test-helpers.js';

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
      model: 'stable-audio-2',
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
