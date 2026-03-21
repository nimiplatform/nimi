import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiAiProvider } from '../../src/ai-provider/index.js';
import { asNimiError } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { APP_ID, SUBJECT_USER_ID, createRuntimeStub } from './provider-test-helpers.js';

test('createNimiAiProvider embedding and image models map runtime responses', async () => {
  const scenarioJobs = new Map<string, {
    job: {
      jobId: string;
      status: number;
      routeDecision: number;
      modelResolved: string;
      traceId: string;
    };
    artifacts: Array<{
      artifactId: string;
      mimeType: string;
      bytes: Uint8Array;
    }>;
  }>();
  let scenarioJobCounter = 0;

  const runtime = createRuntimeStub({
    embed: async () => ({
      vectors: [{
        values: [
          { kind: { oneofKind: 'numberValue', numberValue: 0.1 } },
          { kind: { oneofKind: 'numberValue', numberValue: 0.2 } },
        ],
      }],
      usage: {
        inputTokens: '3',
      },
      routeDecision: 2,
      modelResolved: 'embed/default',
      traceId: 'trace-embed',
    }),
    submitScenarioJob: async () => {
      scenarioJobCounter += 1;
      const jobId = `job-image-${scenarioJobCounter}`;
      scenarioJobs.set(jobId, {
        job: {
          jobId,
          status: 4,
          routeDecision: 1,
          modelResolved: 'image/default',
          traceId: 'trace-image',
        },
        artifacts: [{
          artifactId: 'image-1',
          mimeType: 'image/png',
          bytes: Uint8Array.from([1, 2, 3, 4]),
        }],
      });
      return {
        job: scenarioJobs.get(jobId)?.job,
      };
    },
    getScenarioJob: async (request) => ({
      job: scenarioJobs.get(String((request as { jobId?: string }).jobId || ''))?.job,
    }),
    getScenarioArtifacts: async (request) => {
      const entry = scenarioJobs.get(String((request as { jobId?: string }).jobId || ''));
      return {
        jobId: entry?.job.jobId || '',
        artifacts: entry?.artifacts || [],
        traceId: entry?.job.traceId || '',
      };
    },
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  const embeddingResult = await nimi.embedding('embed/default').doEmbed({
    values: ['query'],
    providerOptions: {},
  });
  assert.deepEqual(embeddingResult.embeddings, [[0.1, 0.2]]);

  const imageResult = await nimi.image('image/default').doGenerate({
    prompt: 'draw',
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
  });
  assert.equal(imageResult.images.length, 1);
  assert.equal(imageResult.images[0], Buffer.from([1, 2, 3, 4]).toString('base64'));
});

test('createNimiAiProvider image model flattens providerOptions and maps files/mask', async () => {
  let capturedSubmitRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    submitScenarioJob: async (request) => {
      capturedSubmitRequest = request as Record<string, unknown>;
      return {
        job: {
          jobId: 'job-image-compat-1',
          status: 4,
          routeDecision: 1,
          modelResolved: 'image/default',
          traceId: 'trace-image-compat',
        },
      };
    },
    getScenarioJob: async () => ({
      job: {
        jobId: 'job-image-compat-1',
        status: 4,
        routeDecision: 1,
        modelResolved: 'image/default',
        traceId: 'trace-image-compat',
      },
    }),
    getScenarioArtifacts: async () => ({
      jobId: 'job-image-compat-1',
      traceId: 'trace-image-compat',
      artifacts: [{
        artifactId: 'image-compat-1',
        mimeType: 'image/png',
        bytes: Uint8Array.from([7, 8, 9]),
      }],
    }),
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  await nimi.image('image/default').doGenerate({
    prompt: 'draw',
    n: 1,
    size: '1024x1024',
    aspectRatio: '1:1',
    files: [
      { type: 'url', url: 'https://example.com/ref-1.png' } as never,
      { type: 'file', mediaType: 'image/png', data: 'QUJD' } as never,
      { type: 'file', mediaType: 'image/jpeg', data: Uint8Array.from([1, 2, 3]) } as never,
    ],
    mask: { type: 'file', mediaType: 'image/png', data: 'Rk9P' } as never,
    providerOptions: {
      requestId: 'req-top',
      idempotencyKey: 'idem-top',
      labels: { source: 'top' },
      quality: 'high-top',
      steps: 40,
      method: 'top-method',
      nimi: {
        responseFormat: 'b64_json',
        requestId: 'req-nimi',
      },
      media: {
        style: 'cinematic',
        method: 'media-method',
      },
    },
  });

  assert.ok(capturedSubmitRequest);
  assert.equal(capturedSubmitRequest.requestId, 'req-top');
  assert.equal(capturedSubmitRequest.idempotencyKey, 'idem-top');
  assert.deepEqual(capturedSubmitRequest.labels, { source: 'top' });
  assert.equal(capturedSubmitRequest.fallback, 1);

  const specRecord = capturedSubmitRequest.spec as { imageSpec?: Record<string, unknown> } | undefined;
  const imageSpec = (specRecord?.imageSpec || {}) as Record<string, unknown>;
  assert.deepEqual(imageSpec.referenceImages, [
    'https://example.com/ref-1.png',
    'data:image/png;base64,QUJD',
    'data:image/jpeg;base64,AQID',
  ]);
  assert.equal(imageSpec.mask, 'data:image/png;base64,Rk9P');
  assert.equal(imageSpec.quality, 'high-top');
  assert.equal(imageSpec.style, 'cinematic');
  assert.equal(imageSpec.responseFormat, 'b64_json');

  assert.equal(imageSpec.providerOptions, undefined);
});

test('createNimiAiProvider image model rejects file payloads without mediaType', async () => {
  const runtime = createRuntimeStub({
    submitScenarioJob: async () => ({
      job: {
        jobId: 'job-image-invalid-1',
        status: 4,
        routeDecision: 1,
        modelResolved: 'image/default',
        traceId: 'trace-image-invalid',
      },
    }),
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  await assert.rejects(
    async () => nimi.image('image/default').doGenerate({
      prompt: 'draw',
      files: [
        { type: 'file', data: 'QUJD' } as never,
      ],
      providerOptions: {},
    }),
    (error: unknown) => {
      const nimiError = asNimiError(error, { source: 'sdk' });
      assert.equal(nimiError.reasonCode, ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID);
      return true;
    },
  );
});
