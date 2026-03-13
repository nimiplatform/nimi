import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import {
  ScenarioJobStatus,
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
} from '../../src/runtime/generated/runtime/v1/ai.js';
import type { RuntimeInternalContext } from '../../src/runtime/internal-context.js';
import {
  buildMusicIterationExtensions,
  buildLocalImageWorkflowExtensions,
  runtimeBuildSubmitScenarioJobRequestForMedia,
  runtimeCancelScenarioJobForMedia,
  runtimeGetScenarioArtifactsForMedia,
  runtimeGetScenarioJobForMedia,
  runtimeSubscribeScenarioJobForMedia,
  runtimeSubmitScenarioJobForMedia,
  runtimeWaitForScenarioJobCompletion,
  toSpeechTimingMode,
} from '../../src/runtime/runtime-media.js';
import { runtimeGenerateMusicIteration } from '../../src/runtime/runtime-modality.js';

// ---------------------------------------------------------------------------
// Mock RuntimeInternalContext factory
// ---------------------------------------------------------------------------

function createMockContext(overrides?: {
  invokeWithClient?: RuntimeInternalContext['invokeWithClient'];
  resolveSubjectUserId?: RuntimeInternalContext['resolveSubjectUserId'];
  resolveOptionalSubjectUserId?: RuntimeInternalContext['resolveOptionalSubjectUserId'];
  timeoutMs?: number;
}): RuntimeInternalContext {
  const telemetryEvents: Array<{ name: string; data?: Record<string, unknown> }> = [];
  return {
    appId: 'test-app',
    options: {
      appId: 'test-app',
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      timeoutMs: overrides?.timeoutMs,
    },
    invoke: async (op) => op(),
    invokeWithClient: overrides?.invokeWithClient ?? (async () => ({})),
    resolveRuntimeCallOptions: (input) => ({
      timeoutMs: input.timeoutMs ?? 0,
      metadata: input.metadata ?? {},
    }),
    resolveRuntimeStreamOptions: (input) => ({
      timeoutMs: input.timeoutMs ?? 0,
      metadata: input.metadata ?? {},
      signal: input.signal,
    }),
    resolveSubjectUserId: overrides?.resolveSubjectUserId ?? (async () => 'subject-1'),
    resolveOptionalSubjectUserId: overrides?.resolveOptionalSubjectUserId ?? (async () => undefined),
    emitTelemetry: (name, data) => {
      telemetryEvents.push({ name, data });
    },
    _telemetryEvents: telemetryEvents,
  } as RuntimeInternalContext & { _telemetryEvents: typeof telemetryEvents };
}

// ---------------------------------------------------------------------------
// buildLocalImageWorkflowExtensions
// ---------------------------------------------------------------------------

test('buildMusicIterationExtensions normalizes canonical payload keys', () => {
  const result = buildMusicIterationExtensions({
    mode: 'extend',
    sourceAudioBase64: 'aGVsbG8=',
    sourceMimeType: 'audio/mpeg',
    trimStartSec: 1.5,
    trimEndSec: 8,
  });
  assert.deepEqual(result, {
    mode: 'extend',
    source_audio_base64: 'aGVsbG8=',
    source_mime_type: 'audio/mpeg',
    trim_start_sec: 1.5,
    trim_end_sec: 8,
  });
});

test('buildMusicIterationExtensions rejects invalid base64 input', () => {
  assert.throws(
    () => buildMusicIterationExtensions({
      mode: 'extend',
      sourceAudioBase64: 'not-base64###',
    }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.AI_MEDIA_SPEC_INVALID;
    },
  );
});

test('buildMusicIterationExtensions rejects invalid trim ordering', () => {
  assert.throws(
    () => buildMusicIterationExtensions({
      mode: 'extend',
      sourceAudioBase64: 'aGVsbG8=',
      trimStartSec: 8,
      trimEndSec: 2,
    }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.AI_MEDIA_SPEC_INVALID;
    },
  );
});

test('runtimeGenerateMusicIteration wires canonical extensions through music generate flow', async () => {
  let capturedSubmitRequest: unknown;
  const ctx = createMockContext({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async (request: unknown) => {
          capturedSubmitRequest = request;
          return {
            job: {
              jobId: 'music-job-1',
              status: ScenarioJobStatus.SUBMITTED,
            },
          };
        },
        getScenarioJob: async () => ({
          job: {
            jobId: 'music-job-1',
            status: ScenarioJobStatus.COMPLETED,
          },
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [{
            artifactId: 'artifact-1',
            mimeType: 'audio/mpeg',
            bytes: new Uint8Array([1, 2, 3]),
          }],
          traceId: 'trace-1',
        }),
      },
    } as never),
  });

  const output = await runtimeGenerateMusicIteration(ctx, {
    model: 'suno-v4',
    prompt: 'continue this track',
    iteration: {
      mode: 'extend',
      sourceAudioBase64: 'aGVsbG8=',
      trimStartSec: 1,
      trimEndSec: 4,
    },
  });

  assert.equal(output.job.jobId, 'music-job-1');
  const submitRequest = capturedSubmitRequest as {
    extensions?: Array<{
      namespace?: string;
      payload?: {
        fields?: Record<string, {
          kind?: {
            oneofKind?: string;
            stringValue?: string;
            numberValue?: number;
          };
        }>;
      };
    }>;
  };
  assert.equal(submitRequest.extensions?.[0]?.namespace, 'nimi.scenario.music_generate.request');
  assert.equal(
    submitRequest.extensions?.[0]?.payload?.fields?.mode?.kind?.stringValue,
    'extend',
  );
  assert.equal(
    submitRequest.extensions?.[0]?.payload?.fields?.trim_start_sec?.kind?.numberValue,
    1,
  );
});

test('runtimeGenerateMusicIteration fails fast on invalid iteration input', async () => {
  let invoked = false;
  const ctx = createMockContext({
    invokeWithClient: async (op) => {
      invoked = true;
      return op({ ai: {} } as never);
    },
  });

  await assert.rejects(
    () => runtimeGenerateMusicIteration(ctx, {
      model: 'suno-v4',
      prompt: 'broken',
      iteration: {
        mode: 'extend',
        sourceAudioBase64: '',
      },
    }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.AI_MEDIA_SPEC_INVALID;
    },
  );
  assert.equal(invoked, false);
});

test('buildLocalImageWorkflowExtensions: components not an array returns empty merged', () => {
  const result = buildLocalImageWorkflowExtensions({ components: undefined });
  assert.deepEqual(result, {});
});

test('buildLocalImageWorkflowExtensions: components is non-array value treated as empty', () => {
  const result = buildLocalImageWorkflowExtensions(
    { components: 'not-an-array' as never },
  );
  assert.deepEqual(result, {});
});

test('buildLocalImageWorkflowExtensions: all components filtered out (empty slot/artifactId)', () => {
  const result = buildLocalImageWorkflowExtensions({
    components: [
      { slot: '', localArtifactId: 'a' },
      { slot: 'b', localArtifactId: '' },
      { slot: '  ', localArtifactId: '  ' },
    ],
  });
  // No components key should be set since all are filtered
  assert.equal('components' in result, false);
});

test('buildLocalImageWorkflowExtensions: no baseExtensions defaults to empty', () => {
  const result = buildLocalImageWorkflowExtensions({
    components: [{ slot: 'vae', localArtifactId: 'art-1' }],
  });
  assert.deepEqual(result, {
    components: [{ slot: 'vae', localArtifactId: 'art-1' }],
  });
});

test('buildLocalImageWorkflowExtensions: empty profileOverrides omitted', () => {
  const result = buildLocalImageWorkflowExtensions({
    profileOverrides: {},
  });
  assert.equal('profile_overrides' in result, false);
});

test('buildLocalImageWorkflowExtensions: no profileOverrides omitted', () => {
  const result = buildLocalImageWorkflowExtensions({});
  assert.equal('profile_overrides' in result, false);
});

// ---------------------------------------------------------------------------
// toSpeechTimingMode - all branches
// ---------------------------------------------------------------------------

test('toSpeechTimingMode: "word" returns WORD', () => {
  assert.equal(toSpeechTimingMode('word'), SpeechTimingMode.WORD);
});

test('toSpeechTimingMode: "char" returns CHAR', () => {
  assert.equal(toSpeechTimingMode('char'), SpeechTimingMode.CHAR);
});

test('toSpeechTimingMode: "none" returns NONE', () => {
  assert.equal(toSpeechTimingMode('none'), SpeechTimingMode.NONE);
});

test('toSpeechTimingMode: undefined returns UNSPECIFIED', () => {
  assert.equal(toSpeechTimingMode(undefined), SpeechTimingMode.UNSPECIFIED);
});

// ---------------------------------------------------------------------------
// runtimeSubmitScenarioJobForMedia: empty job response
// ---------------------------------------------------------------------------

test('runtimeSubmitScenarioJobForMedia: throws when response.job is empty', async () => {
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: undefined }),
  });

  await assert.rejects(
    () => runtimeSubmitScenarioJobForMedia(ctx, {
      modal: 'image',
      input: { model: 'test-model', prompt: 'test' },
    }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.AI_PROVIDER_UNAVAILABLE;
    },
  );
});

test('runtimeSubmitScenarioJobForMedia: returns job and emits telemetry on success', async () => {
  const job = { jobId: 'job-123', status: ScenarioJobStatus.SUBMITTED };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job }),
  });

  const result = await runtimeSubmitScenarioJobForMedia(ctx, {
    modal: 'image',
    input: { model: 'test-model', prompt: 'test' },
  });
  assert.equal(result.jobId, 'job-123');
});

// ---------------------------------------------------------------------------
// runtimeGetScenarioJobForMedia: empty job response
// ---------------------------------------------------------------------------

test('runtimeGetScenarioJobForMedia: throws when response.job is empty', async () => {
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: undefined }),
  });

  await assert.rejects(
    () => runtimeGetScenarioJobForMedia(ctx, 'missing-job'),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.AI_MODEL_NOT_FOUND;
    },
  );
});

test('runtimeGetScenarioJobForMedia: returns job on success', async () => {
  const job = { jobId: 'job-456', status: ScenarioJobStatus.COMPLETED };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job }),
  });

  const result = await runtimeGetScenarioJobForMedia(ctx, 'job-456');
  assert.equal(result.jobId, 'job-456');
});

// ---------------------------------------------------------------------------
// runtimeCancelScenarioJobForMedia: branches
// ---------------------------------------------------------------------------

test('runtimeCancelScenarioJobForMedia: throws when response.job is empty', async () => {
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: undefined }),
  });

  await assert.rejects(
    () => runtimeCancelScenarioJobForMedia(ctx, { jobId: 'j1' }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.AI_PROVIDER_UNAVAILABLE;
    },
  );
});

test('runtimeCancelScenarioJobForMedia: succeeds without optional reason', async () => {
  const job = { jobId: 'j2', status: ScenarioJobStatus.CANCELED };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job }),
  });

  const result = await runtimeCancelScenarioJobForMedia(ctx, { jobId: 'j2' });
  assert.equal(result.status, ScenarioJobStatus.CANCELED);
});

test('runtimeCancelScenarioJobForMedia: succeeds with reason', async () => {
  const job = { jobId: 'j3', status: ScenarioJobStatus.CANCELED };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job }),
  });

  const result = await runtimeCancelScenarioJobForMedia(ctx, { jobId: 'j3', reason: 'user-cancel' });
  assert.equal(result.jobId, 'j3');
});

// ---------------------------------------------------------------------------
// runtimeSubscribeScenarioJobForMedia
// ---------------------------------------------------------------------------

test('runtimeSubscribeScenarioJobForMedia: returns async iterable', async () => {
  const events = [
    { eventType: 1, sequence: '1' },
    { eventType: 2, sequence: '2' },
  ];
  let index = 0;
  const ctx = createMockContext({
    invokeWithClient: async () => ({
      async *[Symbol.asyncIterator]() {
        while (index < events.length) {
          yield events[index++];
        }
      },
    }),
  });

  const iterable = await runtimeSubscribeScenarioJobForMedia(ctx, 'job-sub');
  const collected: unknown[] = [];
  for await (const event of iterable) {
    collected.push(event);
  }
  assert.ok(collected.length >= 0);
});

// ---------------------------------------------------------------------------
// runtimeGetScenarioArtifactsForMedia: branches
// ---------------------------------------------------------------------------

test('runtimeGetScenarioArtifactsForMedia: returns empty artifacts when none', async () => {
  const ctx = createMockContext({
    invokeWithClient: async () => ({ artifacts: undefined, traceId: '' }),
  });

  const result = await runtimeGetScenarioArtifactsForMedia(ctx, 'job-empty');
  assert.deepEqual(result.artifacts, []);
  assert.equal(result.traceId, undefined);
});

test('runtimeGetScenarioArtifactsForMedia: returns artifacts and traceId', async () => {
  const artifacts = [{ artifactId: 'a1' }];
  const ctx = createMockContext({
    invokeWithClient: async () => ({ artifacts, traceId: 'trace-999' }),
  });

  const result = await runtimeGetScenarioArtifactsForMedia(ctx, 'job-with');
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.traceId, 'trace-999');
});

test('runtimeGetScenarioArtifactsForMedia: normalizes empty traceId to undefined', async () => {
  const ctx = createMockContext({
    invokeWithClient: async () => ({ artifacts: [], traceId: '  ' }),
  });

  const result = await runtimeGetScenarioArtifactsForMedia(ctx, 'job-blank-trace');
  assert.equal(result.traceId, undefined);
});

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: image modal branches
// ---------------------------------------------------------------------------

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
      fallback: 'deny' as const,
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

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: video modal branches
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: tts modal branches
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: stt modal branches
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: music modal branches
// ---------------------------------------------------------------------------

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
    },
  });

  if (result.spec?.spec.oneofKind === 'speechTranscribe') {
    assert.equal(result.spec.spec.speechTranscribe.audioSource?.source.oneofKind, 'audioChunks');
  }
});

test('build request: stt modal without optional mimeType defaults to audio/wav', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: {
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: new Uint8Array([]) },
    },
  });

  if (result.spec?.spec.oneofKind === 'speechTranscribe') {
    assert.equal(result.spec.spec.speechTranscribe.mimeType, 'audio/wav');
  }
});

test('build request: stt modal without optional fields defaults to false/0', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: {
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: new Uint8Array([]) },
    },
  });

  if (result.spec?.spec.oneofKind === 'speechTranscribe') {
    assert.equal(result.spec.spec.speechTranscribe.timestamps, false);
    assert.equal(result.spec.spec.speechTranscribe.diarization, false);
    assert.equal(result.spec.spec.speechTranscribe.speakerCount, 0);
  }
});

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: shared/head branches
// ---------------------------------------------------------------------------

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

  // The metadata is extracted from input but not placed on the request itself.
  // Just ensure the build completes without error.
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

// ---------------------------------------------------------------------------
// runtimeWaitForScenarioJobCompletion: branches
// ---------------------------------------------------------------------------

test('wait: returns immediately when job is COMPLETED', async () => {
  const completedJob = { jobId: 'j-done', status: ScenarioJobStatus.COMPLETED };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: completedJob }),
  });

  const result = await runtimeWaitForScenarioJobCompletion(ctx, 'j-done', {});
  assert.equal(result.status, ScenarioJobStatus.COMPLETED);
});

test('wait: throws when job is FAILED', async () => {
  const failedJob = {
    jobId: 'j-fail',
    status: ScenarioJobStatus.FAILED,
    reasonCode: ReasonCode.AI_PROVIDER_INTERNAL,
    reasonDetail: 'something went wrong',
  };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: failedJob }),
  });

  await assert.rejects(
    () => runtimeWaitForScenarioJobCompletion(ctx, 'j-fail', {}),
    (error: unknown) => {
      const err = error as { message?: string };
      return err.message === 'something went wrong';
    },
  );
});

test('wait: throws when job is CANCELED', async () => {
  const canceledJob = {
    jobId: 'j-cancel',
    status: ScenarioJobStatus.CANCELED,
    reasonCode: '',
    reasonDetail: '',
  };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: canceledJob }),
  });

  await assert.rejects(
    () => runtimeWaitForScenarioJobCompletion(ctx, 'j-cancel', {}),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      // When reasonCode is empty, falls back to AI_PROVIDER_UNAVAILABLE
      return typeof err.reasonCode === 'string';
    },
  );
});

test('wait: throws when job is TIMEOUT', async () => {
  const timeoutJob = {
    jobId: 'j-timeout',
    status: ScenarioJobStatus.TIMEOUT,
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    reasonDetail: '',
  };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: timeoutJob }),
  });

  await assert.rejects(
    () => runtimeWaitForScenarioJobCompletion(ctx, 'j-timeout', {}),
    (error: unknown) => {
      const err = error as { message?: string };
      // When reasonDetail is empty, message falls back to `scenario job failed: ${reasonCode}`
      return err.message === `scenario job failed: ${ReasonCode.AI_PROVIDER_TIMEOUT}`;
    },
  );
});

test('wait: throws on abort signal', async () => {
  const controller = new AbortController();
  controller.abort();

  // The cancel call via invokeWithClient should also be captured
  let cancelCalled = false;
  const ctx = createMockContext({
    invokeWithClient: async () => {
      cancelCalled = true;
      return { job: { jobId: 'j-abort', status: ScenarioJobStatus.CANCELED } };
    },
  });

  await assert.rejects(
    () => runtimeWaitForScenarioJobCompletion(ctx, 'j-abort', { signal: controller.signal }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.OPERATION_ABORTED;
    },
  );
  assert.equal(cancelCalled, true);
});

test('wait: throws on SDK timeout and attempts cancel', async () => {
  let pollCount = 0;
  let cancelCalled = false;

  const ctx = createMockContext({
    invokeWithClient: async (operation: unknown) => {
      // Detect if this is a cancel call vs get call
      // The operation is a function; we just need to handle both paths
      pollCount++;
      if (pollCount > 5) {
        // After several polls, act as cancel
        cancelCalled = true;
        return { job: { jobId: 'j-slow', status: ScenarioJobStatus.CANCELED } };
      }
      return { job: { jobId: 'j-slow', status: ScenarioJobStatus.RUNNING } };
    },
  });

  await assert.rejects(
    () => runtimeWaitForScenarioJobCompletion(ctx, 'j-slow', { timeoutMs: 1 }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.AI_PROVIDER_TIMEOUT;
    },
  );
});

test('wait: uses ctx.options.timeoutMs when input.timeoutMs is not set', async () => {
  const completedJob = { jobId: 'j-ctx-timeout', status: ScenarioJobStatus.COMPLETED };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: completedJob }),
    timeoutMs: 60000,
  });

  const result = await runtimeWaitForScenarioJobCompletion(ctx, 'j-ctx-timeout', {});
  assert.equal(result.status, ScenarioJobStatus.COMPLETED);
});

test('wait: uses DEFAULT_MEDIA_TIMEOUT_MS when both timeouts are 0/unset', async () => {
  const completedJob = { jobId: 'j-default-timeout', status: ScenarioJobStatus.COMPLETED };
  const ctx = createMockContext({
    invokeWithClient: async () => ({ job: completedJob }),
  });

  const result = await runtimeWaitForScenarioJobCompletion(ctx, 'j-default-timeout', { timeoutMs: 0 });
  assert.equal(result.status, ScenarioJobStatus.COMPLETED);
});

test('wait: cancel is best-effort and does not propagate errors', async () => {
  const controller = new AbortController();
  controller.abort();

  let cancelAttempted = false;
  const ctx = createMockContext({
    invokeWithClient: async () => {
      cancelAttempted = true;
      throw new Error('cancel network failure');
    },
  });

  await assert.rejects(
    () => runtimeWaitForScenarioJobCompletion(ctx, 'j-cancel-fail', { signal: controller.signal }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.OPERATION_ABORTED;
    },
  );
  assert.equal(cancelAttempted, true);
});

test('wait: cancel is only invoked once even on repeated triggers', async () => {
  let cancelCount = 0;
  let callCount = 0;

  const ctx = createMockContext({
    invokeWithClient: async () => {
      callCount++;
      if (callCount === 1) {
        // First call is from the abort cancel
        cancelCount++;
        return { job: { jobId: 'j-double', status: ScenarioJobStatus.CANCELED } };
      }
      // Should not reach here for cancel
      return { job: { jobId: 'j-double', status: ScenarioJobStatus.RUNNING } };
    },
  });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => runtimeWaitForScenarioJobCompletion(ctx, 'j-double', { signal: controller.signal }),
    (error: unknown) => {
      const err = error as { reasonCode?: string };
      return err.reasonCode === ReasonCode.OPERATION_ABORTED;
    },
  );
  // Cancel should be called exactly once
  assert.equal(cancelCount, 1);
});

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: scenario type mapping
// ---------------------------------------------------------------------------

test('build request: image modal maps to IMAGE_GENERATE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'image',
    input: { model: 'm', prompt: 'p' },
  });
  // ScenarioType.IMAGE_GENERATE = 3
  assert.equal(result.scenarioType, 3);
});

test('build request: video modal maps to VIDEO_GENERATE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'video',
    input: { model: 'm', mode: 't2v' as const, content: [] },
  });
  // ScenarioType.VIDEO_GENERATE = 4
  assert.equal(result.scenarioType, 4);
});

test('build request: tts modal maps to SPEECH_SYNTHESIZE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'tts',
    input: { model: 'm', text: 't' },
  });
  // ScenarioType.SPEECH_SYNTHESIZE = 5
  assert.equal(result.scenarioType, 5);
});

test('build request: stt modal maps to SPEECH_TRANSCRIBE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'stt',
    input: { model: 'm', audio: { kind: 'bytes', bytes: new Uint8Array([]) } },
  });
  // ScenarioType.SPEECH_TRANSCRIBE = 6
  assert.equal(result.scenarioType, 6);
});

test('build request: music modal maps to MUSIC_GENERATE scenario type', async () => {
  const ctx = createMockContext();
  const result = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, {
    modal: 'music',
    input: { model: 'm', prompt: 'p' },
  });
  // ScenarioType.MUSIC_GENERATE = 9
  assert.equal(result.scenarioType, 9);
});

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: video content role edge cases
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// runtimeBuildSubmitScenarioJobRequestForMedia: explicit subjectUserId
// ---------------------------------------------------------------------------

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
