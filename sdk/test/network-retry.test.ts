import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRetryDelayMs,
  normalizeApiError,
  requestWithRetry,
  type RetryEvent,
} from '../src/types/index.js';

function withMockedRandom<T>(value: number, run: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}

test('SDK network retry uses exponential backoff with bounded jitter', () => {
  assert.equal(withMockedRandom(0, () => getRetryDelayMs(1, 120, 10_000)), 120);
  assert.equal(withMockedRandom(0, () => getRetryDelayMs(3, 120, 10_000)), 480);
  assert.equal(withMockedRandom(1, () => getRetryDelayMs(2, 100, 10_000)), 250);
  assert.equal(withMockedRandom(1, () => getRetryDelayMs(5, 200, 500)), 500);
});

test('SDK network retry emits retrying and recovered lifecycle events', async () => {
  const events: RetryEvent[] = [];
  let callCount = 0;

  const result = await requestWithRetry({
    executor: async () => {
      callCount += 1;
      if (callCount === 1) {
        throw { status: 503, message: 'Service Unavailable' };
      }
      return 'ok';
    },
    options: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
    sleepImpl: async () => {},
    onRetryEvent: (event) => events.push(event),
  });

  assert.equal(result, 'ok');
  assert.deepEqual(events.map((event) => event.type), ['retrying', 'recovered']);
});

test('SDK network retry normalizes exhausted API errors', async () => {
  const events: RetryEvent[] = [];

  await assert.rejects(
    () =>
      requestWithRetry({
        executor: async () => {
          throw {
            status: 502,
            body: JSON.stringify({
              reason_code: 'RUNTIME_UNAVAILABLE',
              action_hint: 'retry_runtime',
              trace_id: 'trace-retry',
              message: 'runtime unavailable',
            }),
          };
        },
        options: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
        sleepImpl: async () => {},
        onRetryEvent: (event) => events.push(event),
      }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'RUNTIME_UNAVAILABLE');
      assert.equal((error as { actionHint?: string }).actionHint, 'retry_runtime');
      assert.equal((error as { traceId?: string }).traceId, 'trace-retry');
      return true;
    },
  );

  assert.deepEqual(events.map((event) => event.type), ['retrying', 'retry_exhausted']);
});

test('SDK normalizeApiError preserves existing Error and typed NimiError objects', () => {
  const existing = new Error('plain');
  assert.equal(normalizeApiError(existing), existing);

  const nimiError = Object.assign(new Error('offline'), {
    reasonCode: 'RUNTIME_UNAVAILABLE',
    actionHint: 'retry',
  });
  assert.equal(normalizeApiError(nimiError), nimiError);
});
