import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiRuntimeScenarioJobHead,
  buildNimiRuntimeScenarioJobIdentity,
} from './index';
test('scenario job identity is stable-prefixed and unique per call', () => {
  const first = buildNimiRuntimeScenarioJobIdentity({
    appId: 'nimi.tester',
    capabilityId: 'image.generate',
    scenarioId: 'portrait mode',
  });
  const second = buildNimiRuntimeScenarioJobIdentity({
    appId: 'nimi.tester',
    capabilityId: 'image.generate',
    scenarioId: 'portrait mode',
  });

  assert.match(first.idempotencyKey, /^nimi\.tester:image\.generate:portrait-mode:/);
  assert.equal(first.requestId, first.idempotencyKey);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('scenario job head carries only caller identity and timeout', () => {
  assert.deepEqual(buildNimiRuntimeScenarioJobHead({
    appId: 'nimi.tester',
    subjectUserId: 'user-1',
  }), {
    appId: 'nimi.tester',
    subjectUserId: 'user-1',
    timeoutMs: 120000,
  });
});

test('scenario job head fails closed for invalid timeout', () => {
  assert.throws(
    () => buildNimiRuntimeScenarioJobHead({ appId: 'nimi.tester', timeoutMs: 0 }),
    /timeoutMs must be a positive number/u,
  );
});
