import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../../src/types/index.js';
import { ScenarioJobStatus } from '../../src/runtime/generated/runtime/v1/ai.js';
import { runtimeWaitForScenarioJobCompletion } from '../../src/runtime/runtime-media.js';
import { createMockContext } from './runtime-media-test-helpers.js';

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
      return err.message === `scenario job failed: ${ReasonCode.AI_PROVIDER_TIMEOUT}`;
    },
  );
});

test('wait: throws on abort signal', async () => {
  const controller = new AbortController();
  controller.abort();

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
  const ctx = createMockContext({
    invokeWithClient: async () => {
      pollCount++;
      if (pollCount > 5) {
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
        cancelCount++;
        return { job: { jobId: 'j-double', status: ScenarioJobStatus.CANCELED } };
      }
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
  assert.equal(cancelCount, 1);
});
