import assert from 'node:assert/strict';
import test from 'node:test';

import { assertAgentCenterSourceContextProjection } from '../../../apps/desktop/scripts/explore-materialization-acceptance/acceptance-context-status.mjs';

const readySummary = {
  ready: true,
  state: 'ready',
  truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
};

test('Desktop core keeps exact Agent Center ready admission', () => {
  assert.doesNotThrow(() => assertAgentCenterSourceContextProjection({
    status: 'ready', conversationReport: false, turnContextSummary: null,
  }));
  assert.throws(() => assertAgentCenterSourceContextProjection({
    status: 'truncated', conversationReport: false, turnContextSummary: readySummary,
  }), /not admitted/u);
});

test('conversation report admits only typed ready or bounded truncation', () => {
  assert.doesNotThrow(() => assertAgentCenterSourceContextProjection({
    status: 'ready', conversationReport: true, turnContextSummary: readySummary,
  }));
  assert.doesNotThrow(() => assertAgentCenterSourceContextProjection({
    status: 'truncated',
    conversationReport: true,
    turnContextSummary: { ...readySummary, truncation: [{ reason: 'budget', omittedItemCount: 2, truncatedItemCount: 0 }] },
  }));
  assert.throws(() => assertAgentCenterSourceContextProjection({
    status: 'truncated', conversationReport: true, turnContextSummary: readySummary,
  }), /truncation aggregate/u);
  assert.throws(() => assertAgentCenterSourceContextProjection({
    status: 'ready', conversationReport: true, turnContextSummary: { ...readySummary, ready: false },
  }), /ready typed Runtime/u);
});
