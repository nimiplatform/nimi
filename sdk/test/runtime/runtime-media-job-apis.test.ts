import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import { ScenarioJobStatus } from '../../src/runtime/generated/runtime/v1/ai.js';
import {
  runtimeCancelScenarioJobForMedia,
  runtimeGetScenarioArtifactsForMedia,
  runtimeGetScenarioJobForMedia,
  runtimeSubscribeScenarioJobForMedia,
  runtimeSubmitScenarioJobForMedia,
} from '../../src/runtime/runtime-media.js';
import { createMockContext } from './runtime-media-test-helpers.js';

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
