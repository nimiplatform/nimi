import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuntimeHealthStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import {
  HOME_RESOURCE_WARN_PERCENT,
  HomeMachineStatusView,
  homeRuntimeState,
  type HomeMachineStatusViewProps,
} from '../src/shell/renderer/features/home/home-machine-status.js';

(globalThis as { React?: typeof React }).React = React;

const GB = 1024 ** 3;

function render(overrides: Partial<HomeMachineStatusViewProps> = {}): string {
  const props: HomeMachineStatusViewProps = {
    runtime: 'ready',
    resources: {
      status: 'ready',
      snapshot: {
        cpuPercent: 7,
        memoryUsedBytes: 25.3 * GB,
        memoryTotalBytes: 31.6 * GB,
        diskUsedBytes: 361.6 * GB,
        diskTotalBytes: 731.4 * GB,
        capturedAtMs: Date.now(),
        source: 'test',
      },
    },
    usage: {
      loading: false,
      error: null,
      pricingLoading: false,
      totalRequests: 12,
      totalEstimatedCost: 0.42,
      costCurrency: 'USD',
      hasUnpricedUsage: false,
    },
    onOpenDiagnostics: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<HomeMachineStatusView {...props} />);
}

test('machine status strip shows runtime, three resource percentages, and today cost', async () => {
  await initI18n(); await changeLocale('en');
  const html = render();
  assert.match(html, /data-testid="home-machine-status"/);
  assert.match(html, /data-testid="home-machine-runtime" data-state="ready"/);
  assert.match(html, /Runtime running/);
  assert.match(html, /CPU<\/span><span[^>]*>7%/);
  assert.match(html, /Memory<\/span><span[^>]*>80%/);
  assert.match(html, /Disk<\/span><span[^>]*>49%/);
  assert.match(html, /Today ~\$0\.42/);
  assert.match(html, /12 req/);
  assert.doesNotMatch(html, /data-warn=/);
  assert.doesNotMatch(html, /runtimeConfig\.overview\./);
});

test('resource values at or above the warn threshold are marked, without advice text', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({
    resources: {
      status: 'ready',
      snapshot: {
        cpuPercent: 12,
        memoryUsedBytes: 28 * GB,
        memoryTotalBytes: 32 * GB,
        diskUsedBytes: 100 * GB,
        diskTotalBytes: 200 * GB,
        capturedAtMs: Date.now(),
        source: 'test',
      },
    },
  });
  assert.equal((html.match(/data-warn="true"/g) ?? []).length, 1);
  assert.match(html, /data-warn="true"><span>Memory<\/span><span[^>]*>88%/);
  assert.equal(HOME_RESOURCE_WARN_PERCENT.memory, 85);
});

test('machine status strip degrades per source without hiding the others', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({
    runtime: 'unavailable',
    resources: { status: 'unavailable', snapshot: null },
    usage: { loading: false, error: 'boom', pricingLoading: false, totalRequests: 0, totalEstimatedCost: null, costCurrency: 'USD', hasUnpricedUsage: false },
  });
  assert.match(html, /data-state="unavailable"/);
  assert.match(html, /Runtime connection unavailable/);
  assert.match(html, /System resources unavailable/);
  assert.match(html, /Today&#x27;s usage unavailable/);
  assert.doesNotMatch(html, /title="Some models have unknown pricing"/);
  assert.doesNotMatch(html, /%<\/span>/);
});

test('unpriced usage keeps the cost honest instead of showing zero', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render({
    usage: { loading: false, error: null, pricingLoading: false, totalRequests: 3, totalEstimatedCost: null, costCurrency: 'USD', hasUnpricedUsage: true },
  });
  assert.match(html, /今日预估 N\/A/);
  assert.match(html, /title="部分模型定价未知"/);
  assert.match(html, /3 次/);
});

test('homeRuntimeState maps health query states to the strip states', () => {
  assert.equal(homeRuntimeState({ isPending: true, isError: false, data: undefined }), 'checking');
  assert.equal(homeRuntimeState({ isPending: false, isError: true, data: undefined }), 'unavailable');
  assert.equal(homeRuntimeState({ isPending: false, isError: false, data: { status: RuntimeHealthStatus.READY } }), 'ready');
  assert.equal(homeRuntimeState({ isPending: false, isError: false, data: { status: RuntimeHealthStatus.DEGRADED } }), 'attention');
  assert.equal(homeRuntimeState({ isPending: false, isError: false, data: { status: RuntimeHealthStatus.STOPPED } }), 'attention');
});
