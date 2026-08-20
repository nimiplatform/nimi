import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRetryableSourceRuntimeTransportFailure,
  retrySourceRuntimeTransport,
} from '../src/shell/shared/source-runtime-retry.js';

test('source Runtime retry requires an admitted reason and explicit retryable fact', () => {
  assert.equal(isRetryableSourceRuntimeTransportFailure({
    reasonCode: 'runtime-service-unavailable',
    details: { retryable: true },
  }), true);
  assert.equal(isRetryableSourceRuntimeTransportFailure({
    reasonCode: 'runtime-service-unavailable',
    details: { retryable: false },
  }), false);
  assert.equal(isRetryableSourceRuntimeTransportFailure({
    reasonCode: 'runtime-service-untrusted',
    details: { retryable: true },
  }), false);
});

test('source Runtime retry preserves the terminal structured failure', async () => {
  const failure = {
    reasonCode: 'runtime-restarted',
    envelope: {
      reasonCode: 'runtime-restarted',
      details: { retryable: true },
    },
  };
  let attempts = 0;
  await assert.rejects(
    retrySourceRuntimeTransport(async () => {
      attempts += 1;
      throw failure;
    }, {
      retryDelaysMs: [1, 2],
      sleep: async () => undefined,
    }),
    (error: unknown) => error === failure,
  );
  assert.equal(attempts, 3);
});
