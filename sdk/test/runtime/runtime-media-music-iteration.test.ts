import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import { ScenarioJobStatus, SpeechTimingMode } from '../../src/runtime/generated/runtime/v1/ai.js';
import { musicGenerateOutput } from '../helpers/runtime-ai-shapes.js';
import {
  buildMusicIterationExtensions,
  buildLocalProfileExtensions,
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
          output: musicGenerateOutput('artifact-1'),
        }),
      },
    } as never),
  });

  const output = await runtimeGenerateMusicIteration(ctx, {
    model: 'stable-audio-2',
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
      model: 'stable-audio-2',
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

test('buildLocalProfileExtensions: entryOverrides not an array returns empty merged', () => {
  const result = buildLocalProfileExtensions({ entryOverrides: undefined });
  assert.deepEqual(result, {});
});

test('buildLocalProfileExtensions: entryOverrides is non-array value treated as empty', () => {
  const result = buildLocalProfileExtensions(
    { entryOverrides: 'not-an-array' as never },
  );
  assert.deepEqual(result, {});
});

test('buildLocalProfileExtensions: all entryOverrides filtered out (empty entryId/localAssetId)', () => {
  const result = buildLocalProfileExtensions({
    entryOverrides: [
      { entryId: '', localAssetId: 'a' },
      { entryId: 'b', localAssetId: '' },
      { entryId: '  ', localAssetId: '  ' },
    ],
  });
  assert.equal('entry_overrides' in result, false);
});

test('buildLocalProfileExtensions: no baseExtensions defaults to empty', () => {
  const result = buildLocalProfileExtensions({
    entryOverrides: [{ entryId: 'image-vae', localAssetId: 'art-1' }],
  });
  assert.deepEqual(result, {
    entry_overrides: [{ entry_id: 'image-vae', local_asset_id: 'art-1' }],
  });
});

test('buildLocalProfileExtensions: empty profileOverrides omitted', () => {
  const result = buildLocalProfileExtensions({
    profileOverrides: {},
  });
  assert.equal('profile_overrides' in result, false);
});

test('buildLocalProfileExtensions: no profileOverrides omitted', () => {
  const result = buildLocalProfileExtensions({});
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
