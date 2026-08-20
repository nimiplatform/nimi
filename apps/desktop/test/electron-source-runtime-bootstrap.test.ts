import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DesktopSourceRuntimeUnavailableError,
  requireDesktopSourceRuntime,
  sourceRuntimeBootstrapFailureMessage,
} from '../src-electron/source-runtime-bootstrap.js';

test('Desktop source bootstrap requires one successful protected Runtime probe', async () => {
  let probes = 0;
  await requireDesktopSourceRuntime({
    probe: async () => {
      probes += 1;
      return { enabled: true };
    },
  });
  assert.equal(probes, 1);
});

test('Desktop source bootstrap retries a retryable protected Runtime transport failure', async () => {
  let probes = 0;
  const delays: number[] = [];
  await requireDesktopSourceRuntime({
    probe: async () => {
      probes += 1;
      if (probes < 3) {
        throw Object.assign(new Error('runtime-service-unavailable'), {
          reasonCode: 'runtime-service-unavailable',
          details: { retryable: true },
        });
      }
      return { enabled: true };
    },
  }, {
    retryDelaysMs: [10, 20],
    sleep: async (delayMs) => { delays.push(delayMs); },
  });
  assert.equal(probes, 3);
  assert.deepEqual(delays, [10, 20]);
});

test('Desktop source bootstrap fails closed and points only to the independent Runtime owner', async () => {
  const runtimeFailure = Object.assign(new Error('runtime-service-unavailable'), {
    reasonCode: 'runtime-service-unavailable',
    details: { retryable: true },
  });
  await assert.rejects(
    requireDesktopSourceRuntime({
      probe: async () => {
        throw runtimeFailure;
      },
    }, {
      retryDelaysMs: [],
    }),
    (error: unknown) => {
      assert.ok(error instanceof DesktopSourceRuntimeUnavailableError);
      assert.equal(error.reasonCode, 'source-local-development-runtime-unavailable');
      assert.equal(error.actionHint, 'run_pnpm_dev_runtime');
      assert.equal(error.runtimeReasonCode, 'runtime-service-unavailable');
      assert.equal(error.cause, runtimeFailure);
      return true;
    },
  );

  const message = sourceRuntimeBootstrapFailureMessage(
    'source-local-development-runtime-unavailable',
  );
  assert.match(message, /pnpm dev:runtime/u);
  assert.doesNotMatch(message, /elevat|install|repair|service/iu);
});
