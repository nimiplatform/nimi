import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProductJourneyTimeBudgetMs } from '../harness/time-budget.mjs';

test('product subprocess timeouts consume the registry Journey budget', () => {
  assert.equal(resolveProductJourneyTimeBudgetMs({}, 180_000), 180_000);
  assert.equal(resolveProductJourneyTimeBudgetMs({
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS: '1200000',
  }, 180_000), 1_200_000);
  assert.throws(() => resolveProductJourneyTimeBudgetMs({
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS: 'not-a-duration',
  }, 180_000), /positive safe integer/u);
});
