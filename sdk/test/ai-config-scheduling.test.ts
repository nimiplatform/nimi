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
    selectedBindings: {
      'image.generate': { source: 'cloud', connectorId: 'cloud-1', model: 'image-cloud' },
      'text.embed': { source: 'local', connectorId: '', model: 'embed-local', modelId: 'embed-local' },
      'text.generate': { source: 'local', connectorId: '', model: 'chat-local', modelId: 'chat-local' },
    },
    localProfileRefs: {
      'text.generate': { targetId: 'target-chat', profileId: 'profile-chat' },
      'text.embed': { targetId: 'target-embed', profileId: 'profile-embed' },
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
