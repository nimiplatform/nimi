import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAIRuntimeEvidence,
  projectAIRuntimeEvidenceMetadata,
  type AISchedulingJudgement,
} from '../../src/runtime/index.js';

const judgement: AISchedulingJudgement = {
  state: 'slowdown_risk',
  detail: 'one local slot remains',
  occupancy: {
    globalUsed: 1,
    globalCap: 2,
    appUsed: 1,
    appCap: 1,
  },
  resourceWarnings: ['local queue is almost full'],
};

test('normalizes Runtime AI execution evidence from scheduling judgement', () => {
  assert.deepEqual(createAIRuntimeEvidence({ schedulingJudgement: null }), null);
  assert.deepEqual(createAIRuntimeEvidence({ schedulingJudgement: judgement }), {
    schedulingJudgement: judgement,
  });
});

test('projects Runtime AI execution evidence into request metadata', () => {
  assert.deepEqual(projectAIRuntimeEvidenceMetadata(null), {});
  assert.deepEqual(
    projectAIRuntimeEvidenceMetadata(createAIRuntimeEvidence({ schedulingJudgement: judgement })),
    {
      runtimeSchedulingState: 'slowdown_risk',
      runtimeSchedulingDetail: 'one local slot remains',
    },
  );
});
