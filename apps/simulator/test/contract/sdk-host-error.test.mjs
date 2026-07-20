import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SimulatorSdkErrorScopeViolation,
  projectSimulatorSdkHostFailure,
} from '../../src/sdk/host-error-projection.ts';
import {
  SIMULATOR_ERROR_CODES,
  simulatorError,
} from '../../src/state-engine/errors.ts';

test('SDK host projection exhaustively closes every Simulator error code', () => {
  const expected = new Map([
    ['SIMULATOR_UNSUPPORTED', 'unsupported'],
    ['SIMULATOR_CAPABILITY_DENIED', 'capability-denied'],
    ['SIMULATOR_RESOURCE_EXHAUSTED', 'resource-exhausted'],
    ['SIMULATOR_INVALID_PAYLOAD', 'invalid-input'],
    ['SIMULATOR_STALE_EPOCH', 'host-unavailable'],
    ['SIMULATOR_INSTANCE_DISPOSED', 'host-unavailable'],
    ['SIMULATOR_INSTANCE_FAILED', 'host-unavailable'],
    ['SIMULATOR_MODULE_FAILED', 'host-unavailable'],
    ['SIMULATOR_EFFECT_FORBIDDEN', 'effect-forbidden'],
    ['SIMULATOR_INTEGRITY_FAILURE', 'internal'],
  ]);
  const unreachable = new Set([
    'SIMULATOR_INVALID_MANIFEST',
    'SIMULATOR_SOURCE_MISMATCH',
    'SIMULATOR_INVALID_LIFECYCLE',
  ]);

  assert.equal(expected.size + unreachable.size, SIMULATOR_ERROR_CODES.length);
  for (const code of SIMULATOR_ERROR_CODES) {
    const error = simulatorError(code, {
      moduleId: 'private-module',
      instanceId: '1:instance:1',
      operationId: '1:op:1',
    });
    if (unreachable.has(code)) {
      assert.throws(
        () => projectSimulatorSdkHostFailure(error),
        SimulatorSdkErrorScopeViolation,
      );
      continue;
    }
    const projected = projectSimulatorSdkHostFailure(error);
    assert.deepEqual(projected, { disposition: expected.get(code) });
    assert.deepEqual(Object.keys(projected), ['disposition']);
  }
});
