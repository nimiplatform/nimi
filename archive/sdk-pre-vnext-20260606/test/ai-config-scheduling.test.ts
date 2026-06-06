import assert from 'node:assert/strict';
import test from 'node:test';

import type { AIConfig } from '../src/ai/index.js';
import {
  resolveAIConfigRuntimeSchedulingTargetForCapability,
  resolveAIConfigRuntimeSchedulingTargets,
} from '../src/runtime/index.js';

const CONFIG: AIConfig = {
  scopeRef: { kind: 'app', ownerId: 'dev.nimi.test' },
  capabilities: {
    targetRefs: {
      'image.generate': {
        kind: 'cloud_connector_target_ref',
        connectorId: 'cloud-1',
        providerModelId: 'image-cloud',
      },
      'text.embed': {
        kind: 'local_runtime_target_ref',
        targetId: 'target-embed',
        profileId: 'profile-embed',
      },
      'text.generate': {
        kind: 'local_runtime_target_ref',
        targetId: 'target-chat',
        profileId: 'profile-chat',
      },
    },
    selectedParams: {},
  },
  profileOrigin: null,
};

test('AIConfig scheduling target projection keeps only local Runtime bindings', () => {
  const targets = resolveAIConfigRuntimeSchedulingTargets(CONFIG);

  assert.deepEqual(targets, [
    {
      capability: 'text.embed',
      targetId: 'target-embed',
      profileId: 'profile-embed',
      resourceHint: null,
    },
    {
      capability: 'text.generate',
      targetId: 'target-chat',
      profileId: 'profile-chat',
      resourceHint: null,
    },
  ]);
  assert.deepEqual(resolveAIConfigRuntimeSchedulingTargetForCapability(CONFIG, 'text.generate'), targets[1]);
  assert.equal(resolveAIConfigRuntimeSchedulingTargetForCapability(CONFIG, 'image.generate'), null);
});
