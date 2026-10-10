import assert from 'node:assert/strict';
import test from 'node:test';
import { projectProductActivation, type ProductActivationFacts } from '../src-electron/product-update-activation.js';
const healthy: ProductActivationFacts = { identityMatches: true, running: true, healthy: true, runtimeVersionMatches: true, homeReady: true, helperActive: false };
test('activation requires signed exact identity, protected Runtime version/health and actual Home readiness', () => {
  assert.equal(projectProductActivation(healthy).phase, 'completed');
  for (const key of ['running', 'healthy', 'runtimeVersionMatches'] as const) assert.deepEqual(projectProductActivation({ ...healthy, [key]: false }), { phase: 'recovery-required', reason: 'UPDATE_RUNTIME_HEALTH_FAILED' });
  assert.equal(projectProductActivation({ ...healthy, homeReady: false }).phase, 'awaiting-activation');
  assert.equal(projectProductActivation({ ...healthy, identityMatches: false, installerResult: { phase: 'completed' } }).phase, 'recovery-required', 'installer success never replaces actual identity');
});
test('authorization, handoff, reopen failure and pending OS approval retain precise states', () => {
  for (const reason of ['UPDATE_AUTHORIZATION_CANCELED', 'UPDATE_RUNTIME_HANDOFF_FAILED', 'UPDATE_PARENT_EXIT_FAILED']) {
    assert.deepEqual(projectProductActivation({ ...healthy, identityMatches: false, installerResult: { phase: 'failed', reason } }), { phase: 'failed', reason });
  }
  assert.deepEqual(projectProductActivation({ ...healthy, identityMatches: false, installerResult: { phase: 'recovery-required', reason: 'UPDATE_HOME_REOPEN_FAILED' } }), { phase: 'recovery-required', reason: 'UPDATE_HOME_REOPEN_FAILED' });
  assert.equal(projectProductActivation({ ...healthy, running: false, healthy: false, approvalPending: true }).phase, 'awaiting-activation');
  assert.equal(projectProductActivation({ ...healthy, identityMatches: false, helperActive: true }).phase, 'awaiting-activation');
});
