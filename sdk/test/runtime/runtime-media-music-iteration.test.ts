import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import { ScenarioJobStatus, SpeechTimingMode } from '../../src/runtime/generated/runtime/v1/ai.js';
import {
  buildMusicIterationExtensions,
  buildLocalImageWorkflowExtensions,
  toSpeechTimingMode,
} from '../../src/runtime/runtime-media.js';
import { runtimeGenerateMusicIteration } from '../../src/runtime/runtime-modality.js';
import { createMockContext } from './runtime-media-test-helpers.js';

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
