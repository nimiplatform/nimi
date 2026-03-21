import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiAiProvider } from '../../src/ai-provider/index.js';
import { asNimiError } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { speechSynthesizeOutput, speechTranscribeOutput } from '../helpers/runtime-ai-shapes.js';
import { APP_ID, SUBJECT_USER_ID, createRuntimeStub } from './provider-test-helpers.js';

test('createNimiAiProvider maps runtime failures and exposes video/tts/stt extensions', async () => {
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
    generate: async () => {
      throw JSON.stringify({
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_or_switch_route',
        traceId: 'trace-failure',
        retryable: true,
        message: 'provider timeout',
      });
    },
    submitScenarioJob: async (request) => {
      scenarioJobCounter += 1;
      const jobId = `job-${scenarioJobCounter}`;
      const modal = Number((request as { modal?: number }).modal || 0);
      const modelResolved = String((request as { modelId?: string }).modelId || 'media/default');
      const routeDecision = modal === 3 ? 2 : 1;
      const traceId = modal === 3 ? 'trace-video' : modal === 4 ? 'trace-tts' : 'trace-stt';
      const artifacts = modal === 3
        ? [{
          artifactId: 'video-1',
          mimeType: 'video/mp4',
          bytes: Uint8Array.from([9, 8, 7]),
        }]
        : modal === 4
          ? [{
            artifactId: 'audio-1',
            mimeType: 'audio/wav',
            bytes: Uint8Array.from([6, 5]),
          }]
          : [{
            artifactId: 'stt-1',
            mimeType: 'text/plain',
            bytes: Buffer.from('transcribed text', 'utf8'),
          }];
      scenarioJobs.set(jobId, {
        job: {
          jobId,
          status: 4,
          scenarioType: modal === 3 ? 4 : modal === 4 ? 5 : 6,
          routeDecision,
          modelResolved,
          traceId,
        },
        artifacts,
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
        output: entry?.job.scenarioType === 5
          ? speechSynthesizeOutput('tts-1') as unknown as Record<string, unknown>
          : entry?.job.scenarioType === 6
            ? speechTranscribeOutput('transcribed text', 'stt-1') as unknown as Record<string, unknown>
            : undefined,
      };
    },
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });

  let thrown: unknown = null;
  try {
    await nimi('chat/default').doGenerate({
      prompt: [{
        role: 'user',
        content: [{
          type: 'text',
          text: 'hello',
        }],
      }],
      providerOptions: {},
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'runtime' });
  assert.equal(nimiError.reasonCode, 'AI_PROVIDER_TIMEOUT');
  assert.equal(nimiError.retryable, true);

  const video = await nimi.video('video/default').generate({
    mode: 't2v',
    prompt: 'create video',
    content: [{
      type: 'text',
      role: 'prompt',
      text: 'create video',
    }],
    options: {
      durationSec: 5,
    },
  });
  assert.equal(video.artifacts.length, 1);
  assert.equal(video.artifacts[0]?.routeDecision, 'cloud');

  const tts = await nimi.tts('tts/default').synthesize({
    text: 'hello',
  });
  assert.equal(tts.artifacts.length, 1);
  assert.equal(tts.artifacts[0]?.mimeType, 'audio/wav');

  const stt = await nimi.stt('stt/default').transcribe({
    audioBytes: Uint8Array.from([1, 2, 3]),
    mimeType: 'audio/wav',
  });
  assert.equal(stt.text, 'transcribed text');
  assert.equal(stt.routeDecision, 'local');
});

test('createNimiAiProvider abort signal cancels scenario job before throwing', async () => {
  let cancelCalled = false;
  const runtime = createRuntimeStub({
    submitScenarioJob: async () => ({
      job: {
        jobId: 'job-abort-1',
        status: 2,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-abort',
      },
    }),
    getScenarioJob: async () => ({
      job: {
        jobId: 'job-abort-1',
        status: 3,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-abort',
      },
    }),
    cancelScenarioJob: async () => {
      cancelCalled = true;
      return { canceled: true } as never;
    },
  });
  const abortController = new AbortController();
  abortController.abort();

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });
  await assert.rejects(async () => {
    await nimi.video('video/default').generate({
      mode: 't2v',
      prompt: 'cancel me',
      content: [{
        type: 'text',
        role: 'prompt',
        text: 'cancel me',
      }],
      options: {
        durationSec: 5,
      },
      signal: abortController.signal,
    });
  });
  assert.equal(cancelCalled, true);
});

test('createNimiAiProvider forwards requestId/idempotencyKey/labels to submitScenarioJob', async () => {
  let capturedSubmitRequest: Record<string, unknown> | null = null;
  const runtime = createRuntimeStub({
    submitScenarioJob: async (request) => {
      capturedSubmitRequest = request as Record<string, unknown>;
      return {
        job: {
          jobId: 'job-meta-1',
          status: 4,
          routeDecision: 1,
          modelResolved: 'video/default',
          traceId: 'trace-meta',
        },
      };
    },
    getScenarioJob: async () => ({
      job: {
        jobId: 'job-meta-1',
        status: 4,
        routeDecision: 1,
        modelResolved: 'video/default',
        traceId: 'trace-meta',
      },
    }),
    getScenarioArtifacts: async () => ({
      jobId: 'job-meta-1',
      traceId: 'trace-meta',
      artifacts: [{
        artifactId: 'video-meta-1',
        mimeType: 'video/mp4',
        bytes: Uint8Array.from([1, 2, 3]),
      }],
    }),
  });

  const nimi = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: SUBJECT_USER_ID,
  });
  await nimi.video('video/default').generate({
    mode: 't2v',
    prompt: 'meta',
    content: [{
      type: 'text',
      role: 'prompt',
      text: 'meta',
    }],
    options: {
      durationSec: 5,
    },
    requestId: 'req-001',
    idempotencyKey: 'idem-001',
    labels: {
      source: 'test',
    },
  });
  assert.ok(capturedSubmitRequest);
  assert.equal(capturedSubmitRequest.requestId, 'req-001');
  assert.equal(capturedSubmitRequest.idempotencyKey, 'idem-001');
  assert.deepEqual(capturedSubmitRequest.labels, { source: 'test' });
});
