import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiRuntimeScenarioJobHead,
  buildNimiRuntimeScenarioJobIdentity,
} from './index';
test('scenario job identity is stable-prefixed and unique per call', () => {
  const first = buildNimiRuntimeScenarioJobIdentity({
    appId: 'acme.widget',
    capabilityId: 'image.generate',
    scenarioId: 'portrait mode',
  });
  const second = buildNimiRuntimeScenarioJobIdentity({
    appId: 'acme.widget',
    capabilityId: 'image.generate',
    scenarioId: 'portrait mode',
  });

  assert.match(first.idempotencyKey, /^acme\.widget:image\.generate:portrait-mode:/);
  assert.equal(first.requestId, first.idempotencyKey);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('scenario job head carries only caller identity and timeout', () => {
  assert.deepEqual(buildNimiRuntimeScenarioJobHead({
    appId: 'acme.widget',
    subjectUserId: 'user-1',
  }), {
    appId: 'acme.widget',
    subjectUserId: 'user-1',
    timeoutMs: 120000,
  });
});

test('scenario job head fails closed for invalid timeout', () => {
  assert.throws(
    () => buildNimiRuntimeScenarioJobHead({ appId: 'acme.widget', timeoutMs: 0 }),
    /timeoutMs must be a positive number/u,
  );
});
