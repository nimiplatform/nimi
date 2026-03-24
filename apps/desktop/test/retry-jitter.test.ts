import assert from 'node:assert/strict';
import test from 'node:test';

import { getRetryDelayMs, requestWithRetry } from '../src/runtime/net/request-with-retry';

function withMockedRandom<T>(value: number, run: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}

test('D-NET-002: getRetryDelayMs applies exponential backoff before jitter', () => {
  const attemptOne = withMockedRandom(0, () => getRetryDelayMs(1, 120, 10_000));
  const attemptThree = withMockedRandom(0, () => getRetryDelayMs(3, 120, 10_000));

  assert.equal(attemptOne, 120);
  assert.equal(attemptThree, 480);
});

test('D-NET-002: getRetryDelayMs bounds jitter to initialDelayMs / 2', () => {
  const minDelay = withMockedRandom(0, () => getRetryDelayMs(2, 100, 10_000));
  const maxDelay = withMockedRandom(1, () => getRetryDelayMs(2, 100, 10_000));

  assert.equal(minDelay, 200);
  assert.equal(maxDelay, 250);
});

test('D-NET-002: getRetryDelayMs caps the final delay at maxDelayMs', () => {
  const capped = withMockedRandom(1, () => getRetryDelayMs(5, 200, 500));
  assert.equal(capped, 500);
});

test('D-NET-002: AbortError fails immediately without retrying', async () => {
  const events: unknown[] = [];
  let attempts = 0;

  await assert.rejects(
    () =>
      requestWithRetry({
        executor: async () => {
          attempts += 1;
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        },
        options: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
        sleepImpl: async () => undefined,
        onRetryEvent: (event) => events.push(event),
      }),
    (error: unknown) => {
      assert.equal((error as Error).name, 'AbortError');
      return true;
    },
  );

  assert.equal(attempts, 1);
  assert.deepEqual(events, []);
});
