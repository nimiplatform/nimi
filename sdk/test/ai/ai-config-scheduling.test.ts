import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSchedulingTarget,
  parseAIConfigSchedulingBatchPeekResult,
  peekSchedulingBatch,
  resolveAIConfigScopeSchedulingTargets,
  resolveAIConfigSchedulingTargetForCapability,
  schedulingTargetsEqual,
  toRuntimeSchedulingTarget,
  type AIConfig,
} from '../../src/ai/index.js';

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

test('AIConfig scheduling target projection keeps only local bindings', () => {
  const targets = resolveAIConfigScopeSchedulingTargets(CONFIG);

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
  assert.deepEqual(resolveAIConfigSchedulingTargetForCapability(CONFIG, 'text.generate'), targets[1]);
  assert.equal(resolveAIConfigSchedulingTargetForCapability(CONFIG, 'image.generate'), null);
});

test('AIConfig scheduling target adapter normalizes and maps runtime request shape', () => {
  const normalized = normalizeSchedulingTarget({
    capability: ' text.generate ',
    targetId: ' target-chat ',
    profileId: ' profile-chat ',
    resourceHint: {
      estimatedVramBytes: 12.9,
      estimatedRamBytes: null,
      estimatedDiskBytes: 42,
      engine: ' llama.cpp ',
    },
  });

  assert.deepEqual(normalized, {
    capability: 'text.generate',
    targetId: 'target-chat',
    profileId: 'profile-chat',
    resourceHint: {
      estimatedVramBytes: 12.9,
      estimatedRamBytes: null,
      estimatedDiskBytes: 42,
      engine: ' llama.cpp ',
    },
  });
  assert.equal(schedulingTargetsEqual(normalized!, {
    capability: 'text.generate',
    targetId: 'target-chat',
    profileId: 'profile-chat',
  }), true);
  assert.deepEqual(toRuntimeSchedulingTarget(normalized!), {
    capability: 'text.generate',
    targetId: 'target-chat',
    profileId: 'profile-chat',
    resourceHint: {
      estimatedVramBytes: '12',
      estimatedRamBytes: '0',
      estimatedDiskBytes: '42',
      engine: 'llama.cpp',
    },
  });
});

test('AIConfig scheduling peek calls Runtime and decodes judgement states', async () => {
  const calls: unknown[] = [];
  const result = await peekSchedulingBatch({
    appId: 'dev.nimi.test',
    targets: resolveAIConfigScopeSchedulingTargets(CONFIG),
    peekScheduling: async (request) => {
      calls.push(request);
      return {
        occupancy: {
          globalUsed: 1,
          globalCap: 2,
          appUsed: 1,
          appCap: 1,
        },
        aggregateJudgement: {
          state: 2,
          detail: 'app slot full',
          occupancy: {
            globalUsed: 1,
            globalCap: 2,
            appUsed: 1,
            appCap: 1,
          },
          resourceWarnings: ['queued'],
        },
        targetJudgements: [
          {
            target: {
              capability: 'text.generate',
              targetId: 'target-chat',
              profileId: 'profile-chat',
            },
            judgement: {
              state: 5,
              detail: 'missing dependency',
              resourceWarnings: [],
            },
          },
        ],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    appId: 'dev.nimi.test',
    targets: [
      {
        capability: 'text.embed',
        targetId: 'target-embed',
        profileId: 'profile-embed',
      },
      {
        capability: 'text.generate',
        targetId: 'target-chat',
        profileId: 'profile-chat',
      },
    ],
  });
  assert.equal(result?.aggregateJudgement.state, 'queue_required');
  assert.equal(result?.targetJudgements[0]?.judgement.state, 'denied');
});

test('AIConfig scheduling parser fails closed on missing Runtime aggregate judgement', () => {
  assert.throws(
    () => parseAIConfigSchedulingBatchPeekResult({ targetJudgements: [] }),
    /missing scheduling judgement/,
  );
});
