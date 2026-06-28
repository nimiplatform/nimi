import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiRuntimeScenarioJobHead,
  buildNimiRuntimeScenarioJobIdentity,
} from './index';
import type { RuntimeDurableTargetRef } from '../../core-generated/runtime-protobuf/runtime/v1/runtime_target_identity';

const targetRef: RuntimeDurableTargetRef = {
  target: {
    oneofKind: 'localRuntime',
    localRuntime: {
      version: 'v2',
      ref: { oneofKind: 'profileBindingId', profileBindingId: 'local-runtime:asset-1' },
    },
  },
};

const cloudTargetRef: RuntimeDurableTargetRef = {
  target: {
    oneofKind: 'cloud',
    cloud: {
      version: 'v2',
      connectorId: 'connector-fireworks',
      remoteModelCatalogId: 'remote-catalog:connector-fireworks:fireworks/flux-kontext',
      providerModelId: 'fireworks/flux-kontext',
      provider: 'fireworks',
    },
  },
};

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

test('scenario job head normalizes route policy and preserves runtime target', () => {
  const head = buildNimiRuntimeScenarioJobHead({
    appId: 'nimi.tester',
    subjectUserId: 'user-1',
    modelId: 'model-1',
    routePolicy: 'local',
    connectorId: 'connector-1',
    targetRef,
  });

  assert.equal(head.appId, 'nimi.tester');
  assert.equal(head.subjectUserId, 'user-1');
  assert.equal(head.modelId, 'model-1');
  assert.equal(head.routePolicy, 'local');
  assert.equal(head.connectorId, 'connector-1');
  assert.equal(head.timeoutMs, 120000);
  assert.deepEqual(head.targetRef, targetRef);
});

test('scenario job head derives cloud connector identity from runtime target', () => {
  const head = buildNimiRuntimeScenarioJobHead({
    appId: 'nimi.tester',
    subjectUserId: 'user-1',
    modelId: 'fireworks/flux-kontext',
    routePolicy: 'cloud',
    targetRef: cloudTargetRef,
  });

  assert.equal(head.modelId, 'fireworks/flux-kontext');
  assert.equal(head.connectorId, 'connector-fireworks');
  assert.deepEqual(head.targetRef, cloudTargetRef);
});

test('scenario job head fails closed when cloud model diverges from runtime target', () => {
  assert.throws(
    () => buildNimiRuntimeScenarioJobHead({
      appId: 'nimi.tester',
      subjectUserId: 'user-1',
      modelId: 'legacy-image-alias',
      routePolicy: 'cloud',
      targetRef: cloudTargetRef,
    }),
    /cloud modelId must match targetRef.providerModelId/u,
  );
});

test('scenario job head fails closed without a runtime target ref', () => {
  assert.throws(
    () => buildNimiRuntimeScenarioJobHead({
      appId: 'nimi.tester',
      subjectUserId: 'user-1',
      modelId: 'model-1',
      routePolicy: 'local',
      targetRef: undefined,
    }),
    /requires Runtime targetRef/,
  );
});
