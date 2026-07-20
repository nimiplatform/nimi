import assert from 'node:assert/strict';
import test from 'node:test';

import { createGlobalListenerCoordinator } from '../../src/shell/global-coordinator.ts';
import { installSimulatorIntegrityListener } from '../../src/shell/integrity-listener.ts';

function listenerTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      const current = listeners.get(type) ?? [];
      current.push(handler);
      listeners.set(type, current);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
}

test('integrity error family terminates through bootstrap callback attribution', () => {
  const windowTarget = listenerTarget();
  const documentTarget = listenerTarget();
  const scopes = [];
  const guard = {
    withScope(scope, callback) {
      scopes.push(`${scope.owner}:${scope.phase}`);
      return callback();
    },
  };
  const coordinator = createGlobalListenerCoordinator([{
    id: 'integrity_error',
    eventTarget: 'window',
    eventTypes: ['error', 'unhandledrejection'],
    capture: true,
    passive: false,
    owner: 'simulator-bootstrap',
  }], {
    window: windowTarget,
    document: documentTarget,
  }, {
    run: (owner, phase, callback) => guard.withScope({ owner, phase }, callback),
  });
  let terminalCount = 0;
  installSimulatorIntegrityListener({
    guard,
    coordinator,
    terminate() { terminalCount += 1; },
  });
  assert.equal(coordinator.familyListenerCount('integrity_error'), 2);
  windowTarget.dispatch('error', { message: 'must not enter product state' });
  assert.equal(terminalCount, 1);
  assert.equal(coordinator.familyListenerCount('integrity_error'), 0);
  windowTarget.dispatch('unhandledrejection');
  assert.equal(terminalCount, 1);
  assert.deepEqual(scopes, [
    'simulator-shell:instance-lifecycle',
    'simulator-bootstrap:callback',
    'simulator-shell:instance-lifecycle',
  ]);
});
