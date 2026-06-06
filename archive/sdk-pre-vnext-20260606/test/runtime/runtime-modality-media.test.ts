import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import {
  runtimeGenerateImage,
  runtimeGenerateVideo,
  runtimeListSpeechVoices,
  runtimeStreamImage,
  runtimeStreamVideo,
  runtimeSynthesizeSpeech,
  runtimeTranscribeSpeech,
} from '../../src/runtime/runtime-modality.js';
import {
  imageGenerateOutput,
  speechSynthesizeOutput,
  speechTranscribeOutput,
  videoGenerateOutput,
} from '../helpers/runtime-ai-shapes.js';
import { createMockCtx, makeArtifact, makeJob } from './runtime-modality-test-helpers.js';

// ---------------------------------------------------------------------------
// runtimeTranscribeSpeech — empty artifacts branch
// ---------------------------------------------------------------------------

test('runtimeTranscribeSpeech: empty artifacts returns empty text', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-1' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-1' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [],
          traceId: 'trace-stt-empty',
          output: speechTranscribeOutput(''),
        }),
      },
    } as never),
  });

  const result = await runtimeTranscribeSpeech(ctx, {
    model: 'stt-model',
    audio: { kind: 'bytes', bytes: new Uint8Array([1]) },
    mimeType: 'audio/wav',
  });

  assert.equal(result.text, '');
});

test('runtimeTranscribeSpeech: artifact with bytes returns decoded text', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-2' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-2' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [{ bytes: Buffer.from('hello world', 'utf8') }],
          traceId: 'trace-stt-text',
          output: speechTranscribeOutput('hello world'),
        }),
      },
    } as never),
  });

  const result = await runtimeTranscribeSpeech(ctx, {
    model: 'stt-model',
    audio: { kind: 'bytes', bytes: new Uint8Array([1]) },
    mimeType: 'audio/wav',
  });

  assert.equal(result.text, 'hello world');
});

test('runtimeTranscribeSpeech: mismatched typed output fails closed', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-3' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'stt-job-3' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [],
          traceId: 'trace-stt-mismatch',
          output: imageGenerateOutput('img-art-1'),
        }),
      },
    } as never),
  });

  await assert.rejects(
    () => runtimeTranscribeSpeech(ctx, {
      model: 'stt-model',
      audio: { kind: 'bytes', bytes: new Uint8Array([1]) },
      mimeType: 'audio/wav',
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// runtimeGenerateImage — traceId fallback branch
// ---------------------------------------------------------------------------

test('runtimeGenerateImage: artifacts.traceId used when present', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-1', traceId: 'job-trace' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-1', traceId: 'job-trace' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('art-1', new Uint8Array([1]))],
          traceId: 'artifacts-trace',
          output: imageGenerateOutput('art-1'),
        }),
      },
    } as never),
  });

  const result = await runtimeGenerateImage(ctx, {
    model: 'image-model',
    prompt: 'test',
  });

  assert.equal(result.trace.traceId, 'artifacts-trace');
});

test('runtimeGenerateImage: falls back to job.traceId when artifacts.traceId is empty', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-2', traceId: 'job-trace-fb' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'img-job-2', traceId: 'job-trace-fb' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('art-2', new Uint8Array([2]))],
          traceId: '',
          output: imageGenerateOutput('art-2'),
        }),
      },
    } as never),
  });

  const result = await runtimeGenerateImage(ctx, {
    model: 'image-model',
    prompt: 'test-fallback',
  });

  assert.equal(result.trace.traceId, 'job-trace-fb');
});

// ---------------------------------------------------------------------------
// runtimeGenerateVideo — traceId fallback branch
// ---------------------------------------------------------------------------

test('runtimeGenerateVideo: artifacts.traceId used over job.traceId', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'vid-job-1', traceId: 'vid-job-trace' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'vid-job-1', traceId: 'vid-job-trace' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('vid-art', new Uint8Array([1]))],
          traceId: 'vid-art-trace',
          output: videoGenerateOutput('vid-art'),
        }),
      },
    } as never),
  });

  const result = await runtimeGenerateVideo(ctx, {
    mode: 't2v',
    model: 'video-model',
    prompt: 'test',
    content: [{ type: 'text', text: 'hello' }],
  });

  assert.equal(result.trace.traceId, 'vid-art-trace');
});

// ---------------------------------------------------------------------------
// runtimeSynthesizeSpeech — traceId fallback branch
// ---------------------------------------------------------------------------

test('runtimeSynthesizeSpeech: typed artifacts remain valid when top-level artifacts are empty', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'tts-job-1', traceId: 'tts-job-trace' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'tts-job-1', traceId: 'tts-job-trace' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [],
          traceId: undefined,
          output: speechSynthesizeOutput('tts-art-1'),
        }),
      },
    } as never),
  });

  const result = await runtimeSynthesizeSpeech(ctx, {
    model: 'tts-model',
    text: 'speech',
  });

  assert.equal(result.trace.traceId, 'tts-job-trace');
  assert.equal(result.artifacts[0]?.artifactId, 'tts-art-1');
});

// ---------------------------------------------------------------------------
// runtimeStreamImage / runtimeStreamVideo — delegates through generate
// ---------------------------------------------------------------------------

test('runtimeStreamImage: delegates through runtimeGenerateImage to streamArtifactsFromMediaOutput', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'si-job' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'si-job' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('si-art', new Uint8Array([10, 20]))],
          traceId: 'si-trace',
          output: imageGenerateOutput('si-art'),
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamImage(ctx, {
    model: 'image-model',
    prompt: 'stream img',
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.eof, true);
});

test('runtimeStreamVideo: delegates through runtimeGenerateVideo to streamArtifactsFromMediaOutput', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({
          job: makeJob({ jobId: 'sv-job' }),
        }),
        getScenarioJob: async () => ({
          job: makeJob({ jobId: 'sv-job' }),
        }),
        getScenarioArtifacts: async () => ({
          artifacts: [makeArtifact('sv-art', new Uint8Array([30, 40]))],
          traceId: 'sv-trace',
          output: videoGenerateOutput('sv-art'),
        }),
      },
    } as never),
  });

  const stream = await runtimeStreamVideo(ctx, {
    mode: 't2v',
    model: 'video-model',
    prompt: 'stream vid',
    content: [{ type: 'text', text: 'vid prompt' }],
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.eof, true);
});

// ---------------------------------------------------------------------------
// runtimeListSpeechVoices — branch coverage
// ---------------------------------------------------------------------------

test('runtimeListSpeechVoices: voiceCount is undefined when metadata returns NaN', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({
              'x-nimi-voice-catalog-source': 'test-source',
              'x-nimi-voice-catalog-version': '2.0',
              'x-nimi-voice-count': 'not-a-number',
            });
          }
          return {
            voices: [{ voiceId: 'v1', name: 'Voice 1', lang: 'en', supportedLangs: ['en', 'fr'] }],
            modelResolved: 'voice-model',
            traceId: 'voice-trace',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.equal(result.voiceCount, undefined);
  assert.equal(result.voiceCatalogSource, 'test-source');
  assert.equal(result.voiceCatalogVersion, '2.0');
  assert.equal(result.voices.length, 1);
  assert.equal(result.voices[0]!.voiceId, 'v1');
  assert.deepEqual(result.voices[0]!.supportedLangs, ['en', 'fr']);
});

test('runtimeListSpeechVoices: cloud route prefixes raw model ids before request', async () => {
  let capturedRequest: { modelId?: string } | undefined;
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          capturedRequest = request as { modelId?: string };
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({});
          }
          return {
            voices: [],
            modelResolved: 'cloud/step-tts-2',
            traceId: 'voice-trace',
          };
        },
      },
    } as never),
  });

  await runtimeListSpeechVoices(ctx, {
    model: 'step-tts-2',
    route: 'cloud',
  });

  assert.equal(capturedRequest?.modelId, 'cloud/step-tts-2');
});

test('runtimeListSpeechVoices: voiceCount is a number when metadata is valid', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({
              'x-nimi-voice-catalog-source': '',
              'x-nimi-voice-catalog-version': '',
              'x-nimi-voice-count': '42',
            });
          }
          return {
            voices: [],
            modelResolved: 'voice-model',
            traceId: 'voice-trace',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.equal(result.voiceCount, 42);
  assert.equal(result.voiceCatalogSource, undefined);
  assert.equal(result.voiceCatalogVersion, undefined);
  assert.equal(result.voices.length, 0);
});

test('runtimeListSpeechVoices: undefined voices in response mapped to empty array', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({});
          }
          return {
            voices: undefined,
            modelResolved: '',
            traceId: '',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.equal(result.voices.length, 0);
});

test('runtimeListSpeechVoices: voice with undefined supportedLangs defaults to empty array', async () => {
  const ctx = createMockCtx({
    invokeWithClient: async (op) => op({
      ai: {
        listPresetVoices: async (_request: unknown, options: { _responseMetadataObserver?: (m: Record<string, string>) => void }) => {
          if (options._responseMetadataObserver) {
            options._responseMetadataObserver({});
          }
          return {
            voices: [{ voiceId: 'v2', name: 'Voice 2', lang: 'de', supportedLangs: undefined }],
            modelResolved: 'model',
            traceId: 'trace',
          };
        },
      },
    } as never),
  });

  const result = await runtimeListSpeechVoices(ctx, {
    model: 'voice-model',
  });

  assert.deepEqual(result.voices[0]!.supportedLangs, []);
});
