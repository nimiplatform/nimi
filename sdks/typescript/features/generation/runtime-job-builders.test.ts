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

  assert.match(first.idempotencyKey, /^acme-widget_image-generate_portrait-mode_/);
  assert.match(first.idempotencyKey, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(first.requestId, first.idempotencyKey);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('scenario job head carries identity and a zero withdrawn wire slot', () => {
  assert.deepEqual(buildNimiRuntimeScenarioJobHead({
    appId: 'acme.widget',
    subjectUserId: 'user-1',
  }), {
    appId: 'acme.widget',
    subjectUserId: 'user-1',
    timeoutMs: 0,
  });
});

test('scenario job head fails closed for invalid timeout', () => {
  assert.throws(
    () => buildNimiRuntimeScenarioJobHead({ appId: 'acme.widget', timeoutMs: 0 } as never),
    /business timeout/u,
  );
});
