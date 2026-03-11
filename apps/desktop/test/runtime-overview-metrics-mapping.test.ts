import assert from 'node:assert/strict';
import test from 'node:test';

import type { UsageStatRecord } from '@nimiplatform/sdk/runtime';
import { mapUsageRecordsToEstimate } from '../src/shell/renderer/features/runtime-config/runtime-config-cost-estimator';
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
    source: 'tauri-macos',
  });
  assert.equal(snapshot.cpuPercent, 34.2);
  assert.equal(snapshot.memoryTotalBytes, 16_000_000_000);
  assert.equal(snapshot.source, 'tauri-macos');
});
