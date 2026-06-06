import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeRuntimeSchedulingTarget,
  parseRuntimeSchedulingBatchPeekResult,
  peekRuntimeSchedulingBatch,
  runtimeSchedulingTargetsEqual,
  toRuntimeSchedulingPeekTarget,
  type AISchedulingEvaluationTarget,
} from '../../src/runtime/index.js';

const TARGETS: AISchedulingEvaluationTarget[] = [
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
];

test('runtime scheduling module does not import AIConfig projection helpers', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../src/runtime/runtime-scheduling.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /from ['"].*\/ai\//);
  assert.doesNotMatch(source, /AIConfig/);
  const retiredProjectionName = 'resolve' + 'RuntimeSchedulingTargetsFromAIConfig';
  assert.equal(source.includes(retiredProjectionName), false);
});

test('runtime scheduling target adapter normalizes and maps runtime request shape', () => {
  const normalized = normalizeRuntimeSchedulingTarget({
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
  assert.equal(runtimeSchedulingTargetsEqual(normalized!, {
    capability: 'text.generate',
    targetId: 'target-chat',
    profileId: 'profile-chat',
  }), true);
  assert.deepEqual(toRuntimeSchedulingPeekTarget(normalized!), {
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

test('runtime scheduling peek helper calls Runtime and decodes judgement states', async () => {
  const calls: unknown[] = [];
  const result = await peekRuntimeSchedulingBatch({
    appId: 'dev.nimi.test',
    targets: TARGETS,
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

test('runtime scheduling parser fails closed on missing Runtime aggregate judgement', () => {
  assert.throws(
    () => parseRuntimeSchedulingBatchPeekResult({ targetJudgements: [] }),
    /missing scheduling judgement/,
  );
});
