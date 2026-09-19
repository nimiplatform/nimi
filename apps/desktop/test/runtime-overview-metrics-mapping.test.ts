import assert from 'node:assert/strict';
import test from 'node:test';

import type { UsageStatRecord } from '@nimiplatform/sdk/runtime/wire-types';
import {
  applyPricingToEstimate,
  calculateModelCost,
  mapUsageRecordsToEstimate,
} from '../src/shell/renderer/features/runtime-config/runtime-config-cost-estimator';
import type { PricingEntry } from '../src/shell/renderer/features/runtime-config/runtime-config-pricing-index';
import { parseSystemResourceSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/runtime-parsers';

test('mapUsageRecordsToEstimate aggregates request/token/compute totals', () => {
  const records = [
    {
      capability: 'chat',
      modelId: 'openai/gpt-4o-mini',
      requestCount: '3',
      inputTokens: '120',
      outputTokens: '45',
      computeMs: '2200',
      queueWaitMs: '140',
    },
    {
      capability: 'chat',
      modelId: 'openai/gpt-4o-mini',
      requestCount: '2',
      inputTokens: '90',
      outputTokens: '30',
      computeMs: '1300',
      queueWaitMs: '60',
    },
  ] as UsageStatRecord[];

  const estimate = mapUsageRecordsToEstimate(records);
  assert.equal(estimate.totalRequests, 5);
  assert.equal(estimate.totalInputTokens, 210);
  assert.equal(estimate.totalOutputTokens, 75);
  assert.equal(estimate.totalComputeMs, 3500);
  assert.equal(estimate.totalQueueWaitMs, 200);
  assert.equal(estimate.breakdown.length, 1);
  assert.equal(estimate.breakdown[0]?.label, 'chat · openai/gpt-4o-mini');
});

test('parseSystemResourceSnapshot validates and normalizes bridge payload', () => {
  const snapshot = parseSystemResourceSnapshot({
    cpuPercent: 34.2,
    memoryUsedBytes: 4_000_000_000,
    memoryTotalBytes: 16_000_000_000,
    diskUsedBytes: 120_000_000_000,
    diskTotalBytes: 512_000_000_000,
    capturedAtMs: 1762473600000,
    source: 'electron-darwin',
  });
  assert.equal(snapshot.cpuPercent, 34.2);
  assert.equal(snapshot.memoryTotalBytes, 16_000_000_000);
  assert.equal(snapshot.source, 'electron-darwin');
});

function pricingEntry(input: { unit: string; input: string; output: string; currency?: string }): PricingEntry {
  return {
    provider: 'test',
    pricing: {
      unit: input.unit,
      input: input.input,
      output: input.output,
      currency: input.currency ?? 'USD',
      asOf: '2026-08-16',
      notes: '',
    },
  };
}

test('mapUsageRecordsToEstimate keeps every group so totals cover more than the display cap', () => {
  const records = Array.from({ length: 8 }, (_, index) => ({
    capability: 'chat',
    modelId: `model-${index}`,
    requestCount: String(8 - index),
    inputTokens: '100',
    outputTokens: '50',
    computeMs: '1000',
    queueWaitMs: '0',
  })) as UsageStatRecord[];

  const estimate = mapUsageRecordsToEstimate(records);
  assert.equal(estimate.breakdown.length, 8);
  assert.equal(estimate.totalRequests, 36);

  const pricing = new Map(estimate.breakdown.map((entry) => [
    entry.modelId,
    pricingEntry({ unit: 'token', input: '1', output: '2' }),
  ]));
  const priced = applyPricingToEstimate(estimate, pricing);
  // Every group is priced: 100 * 1 + 50 * 2 = 200 per 1M units per group.
  assert.equal(priced.breakdown.length, 8);
  assert.ok(priced.totalEstimatedCost !== null);
  assert.ok(Math.abs(priced.totalEstimatedCost - 0.0016) < 1e-12, `total covers all 8 groups, got ${priced.totalEstimatedCost}`);
  assert.equal(priced.costCurrency, 'USD');
  assert.equal(priced.hasUnpricedUsage, false);
});

test('calculateModelCost prices the catalog second unit per sixty seconds', () => {
  // rule.nimi.runtime.model-catalog.r004: unit "second" prices per sixty seconds.
  const result = calculateModelCost(
    { requests: 1, inputTokens: 0, outputTokens: 0, computeMs: 120_000 },
    pricingEntry({ unit: 'second', input: '0.3', output: 'unknown' }).pricing,
  );
  assert.equal(result.cost, 0.6);
  assert.equal(result.currency, 'USD');
});

test('calculateModelCost never counts an unknown participating price as zero', () => {
  const unknownInput = calculateModelCost(
    { requests: 2, inputTokens: 100, outputTokens: 50, computeMs: 1000 },
    pricingEntry({ unit: 'token', input: 'unknown', output: '2' }).pricing,
  );
  assert.equal(unknownInput.cost, null);

  const unknownRequest = calculateModelCost(
    { requests: 2, inputTokens: 0, outputTokens: 0, computeMs: 0 },
    pricingEntry({ unit: 'request', input: 'unknown', output: 'unknown' }).pricing,
  );
  assert.equal(unknownRequest.cost, null);

  const unknownUnit = calculateModelCost(
    { requests: 2, inputTokens: 100, outputTokens: 50, computeMs: 1000 },
    pricingEntry({ unit: 'pixel', input: '1', output: '1' }).pricing,
  );
  assert.equal(unknownUnit.cost, null);

  const free = calculateModelCost(
    { requests: 2, inputTokens: 100, outputTokens: 50, computeMs: 1000 },
    pricingEntry({ unit: 'token', input: '0', output: '0', currency: 'none' }).pricing,
  );
  assert.deepEqual(free, { cost: 0, currency: 'none' });
});

test('applyPricingToEstimate excludes unpriced usage from the total and projects it', () => {
  const records = [
    { capability: 'chat', modelId: 'priced', requestCount: '1', inputTokens: '1000000', outputTokens: '0', computeMs: '0', queueWaitMs: '0' },
    { capability: 'chat', modelId: 'unknown-price', requestCount: '5', inputTokens: '9000000', outputTokens: '0', computeMs: '0', queueWaitMs: '0' },
    { capability: 'chat', modelId: 'no-catalog-entry', requestCount: '7', inputTokens: '8000000', outputTokens: '0', computeMs: '0', queueWaitMs: '0' },
  ] as UsageStatRecord[];
  const estimate = mapUsageRecordsToEstimate(records);
  const priced = applyPricingToEstimate(estimate, new Map([
    ['priced', pricingEntry({ unit: 'token', input: '2', output: '3' })],
    ['unknown-price', pricingEntry({ unit: 'token', input: 'unknown', output: 'unknown' })],
  ]));

  assert.equal(priced.totalEstimatedCost, 2);
  assert.equal(priced.hasUnpricedUsage, true);
  assert.equal(priced.breakdown.find((entry) => entry.modelId === 'unknown-price')?.estimatedCost, null);
  assert.equal(priced.breakdown.find((entry) => entry.modelId === 'no-catalog-entry')?.estimatedCost, null);
});

test('applyPricingToEstimate keeps a mixed-currency window total null', () => {
  const records = [
    { capability: 'chat', modelId: 'usd-model', requestCount: '1', inputTokens: '1000000', outputTokens: '0', computeMs: '0', queueWaitMs: '0' },
    { capability: 'chat', modelId: 'cny-model', requestCount: '1', inputTokens: '1000000', outputTokens: '0', computeMs: '0', queueWaitMs: '0' },
  ] as UsageStatRecord[];
  const estimate = mapUsageRecordsToEstimate(records);
  const priced = applyPricingToEstimate(estimate, new Map([
    ['usd-model', pricingEntry({ unit: 'token', input: '2', output: '3', currency: 'USD' })],
    ['cny-model', pricingEntry({ unit: 'token', input: '2', output: '3', currency: 'CNY' })],
  ]));

  assert.equal(priced.totalEstimatedCost, null);
  assert.equal(priced.hasUnpricedUsage, false);
  assert.equal(priced.breakdown.every((entry) => entry.estimatedCost === 2), true);
});
