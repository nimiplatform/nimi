import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { resolveProductJourneyTimeBudgetMs } from '../harness/time-budget.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

test('product subprocess timeouts consume the registry Journey budget', () => {
  assert.equal(resolveProductJourneyTimeBudgetMs({}, 180_000), 180_000);
  assert.equal(resolveProductJourneyTimeBudgetMs({
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS: '1200000',
  }, 180_000), 1_200_000);
  assert.throws(() => resolveProductJourneyTimeBudgetMs({
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS: 'not-a-duration',
  }, 180_000), /positive safe integer/u);
  const desktop = fs.readFileSync(path.join(repoRoot, 'apps/desktop/scripts/explore-materialization-acceptance/acceptance-product-journey.mjs'), 'utf8');
  const zhiyu = fs.readFileSync(path.join(repoRoot, 'apps/zhiyu/test/e2e/electron-real-local-agent-acceptance.test.mjs'), 'utf8');
  assert.match(desktop, /resolveProductJourneyTimeBudgetMs\(process\.env, 180_000\)/u);
  assert.match(zhiyu, /timeout:\s*zhiyuJourneyTimeoutMs/u);
});
