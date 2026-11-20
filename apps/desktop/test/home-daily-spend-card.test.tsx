import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopAIExecutionRoute, type DesktopAIUsageSummary } from '@nimiplatform/sdk/runtime/generated';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { HomeDailySpendCardView } from '../src/shell/renderer/features/home/home-daily-spend-card.js';
import type { SystemEntryAIState } from '../src/shell/renderer/features/system-entry/system-entry-ai-model.js';
import { systemEntryDayRange } from '../src/shell/renderer/features/system-entry/system-entry-time.js';

(globalThis as { React?: typeof React }).React = React;

const RANGE = systemEntryDayRange(Date.UTC(2026, 10, 20, 4, 0, 0), 'Asia/Shanghai');

function makeSummary(overrides: Partial<DesktopAIUsageSummary> = {}): DesktopAIUsageSummary {
  return {
    fromTime: RANGE.fromTime,
    toTime: RANGE.toTime,
    readAt: RANGE.toTime,
    coverageFrom: RANGE.fromTime,
    coverageTo: RANGE.toTime,
    sourceComplete: true,
    timeComplete: true,
    quantityComplete: true,
    groupsComplete: true,
    partialReasons: [],
    sourceCoverage: [{ source: 'app', activityComplete: true, usageComplete: true }],
    totals: {
      attemptCount: '18',
      pendingUsageCount: '0',
      unpricedAttemptCount: '0',
    },
    estimates: [
      { currency: 'USD', estimatedAmount: '0.42', pricingBasis: 'captured_catalog_estimate' },
      { currency: 'CNY', estimatedAmount: '1.85', pricingBasis: 'captured_catalog_estimate' },
    ],
    groups: [
      {
        sourceKind: 'app',
        capability: 'text.generate',
        route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL,
        models: [{ providerId: 'local', modelId: 'qwen2.5-7b', displayName: 'Qwen2.5 7B', role: 'primary' }],
        totals: { attemptCount: '12', pendingUsageCount: '0', unpricedAttemptCount: '0' },
        estimates: [],
      },
      {
        sourceKind: 'app',
        capability: 'text.generate',
        route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
        models: [{ providerId: 'openai', modelId: 'gpt-4o', displayName: 'GPT-4o', role: 'primary' }],
        totals: { attemptCount: '4', pendingUsageCount: '0', unpricedAttemptCount: '0' },
        estimates: [{ currency: 'USD', estimatedAmount: '0.42', pricingBasis: 'captured_catalog_estimate' }],
      },
      {
        sourceKind: 'local-agent',
        capability: 'text.generate',
        route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
        models: [{ providerId: 'dashscope', modelId: 'qwen-max', displayName: 'Qwen Max', role: 'primary' }],
        totals: { attemptCount: '2', pendingUsageCount: '0', unpricedAttemptCount: '0' },
        estimates: [{ currency: 'CNY', estimatedAmount: '1.85', pricingBasis: 'captured_catalog_estimate' }],
      },
    ],
    ...overrides,
  };
}

function aiState(summary: DesktopAIUsageSummary | null, status: 'loading' | 'ready' | 'unavailable' = 'ready'): SystemEntryAIState {
  return {
    range: RANGE,
    activity: { status: 'ready', value: null, error: null },
    usage: { status, value: summary, error: status === 'unavailable' ? 'failed' : null },
  };
}

test('daily spend card renders separate currencies, local-vs-cloud split, top cloud models, and connected cloud count', async () => {
  await initI18n();
  await changeLocale('zh');
  const html = renderToStaticMarkup(
    <HomeDailySpendCardView
      ai={aiState(makeSummary())}
      cloudConnectorCount={2}
      onOpenDetails={() => {}}
      onOpenCloud={() => {}}
    />,
  );
  assert.match(html, /data-testid="home-daily-spend-currency:USD"[\s\S]*?0\.42/);
  assert.match(html, /data-testid="home-daily-spend-currency:CNY"[\s\S]*?1\.85/);
  assert.match(html, /各币种分别列出，不相加/);
  assert.match(html, /共 18 次 · 本地 12 \/ 云端 6/);
  assert.match(html, /GPT-4o/);
  assert.match(html, /openai/);
  assert.match(html, /USD 0\.42/);
  assert.match(html, /Qwen Max/);
  assert.match(html, /CNY 1\.85/);
  assert.match(html, /已接入 2 个云服务/);
  assert.doesNotMatch(html, /home-daily-spend-warning/);
});

test('daily spend card highlights zero API cost for pure local usage and suppresses cost-unknown noise on zero complete runs', async () => {
  await initI18n();
  await changeLocale('zh');
  const localOnlyHtml = renderToStaticMarkup(
    <HomeDailySpendCardView
      ai={aiState(makeSummary({
        totals: { attemptCount: '10', pendingUsageCount: '0', unpricedAttemptCount: '0' },
        estimates: [],
        groups: [{
          sourceKind: 'app',
          capability: 'text.generate',
          route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL,
          models: [{ providerId: 'local', modelId: 'qwen', displayName: 'Qwen', role: 'primary' }],
          totals: { attemptCount: '10', pendingUsageCount: '0', unpricedAttemptCount: '0' },
          estimates: [],
        }],
      }))}
      cloudConnectorCount={0}
      onOpenDetails={() => {}}
      onOpenCloud={() => {}}
    />,
  );
  assert.match(localOnlyHtml, /纯本地免计费运行/);
  assert.doesNotMatch(localOnlyHtml, /费用暂无法估算/);

  const zeroHtml = renderToStaticMarkup(
    <HomeDailySpendCardView
      ai={aiState(makeSummary({
        totals: { attemptCount: '0', pendingUsageCount: '0', unpricedAttemptCount: '0' },
        estimates: [],
        groups: [],
      }))}
      cloudConnectorCount={0}
      onOpenDetails={() => {}}
      onOpenCloud={() => {}}
    />,
  );
  assert.match(zeroHtml, /今日暂无 AI 调用/);
  assert.doesNotMatch(zeroHtml, /费用暂无法估算/);
});

test('daily spend card preserves honest incomplete disclosure when cloud runs lack pricing', async () => {
  await initI18n();
  await changeLocale('en');
  const html = renderToStaticMarkup(
    <HomeDailySpendCardView
      ai={aiState(makeSummary({
        totals: { attemptCount: '3', pendingUsageCount: '0', unpricedAttemptCount: '3' },
        estimates: [],
        groups: [{
          sourceKind: 'app',
          capability: 'text.generate',
          route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
          models: [{ providerId: 'custom', modelId: 'custom-llm', displayName: 'Custom LLM', role: 'primary' }],
          totals: { attemptCount: '3', pendingUsageCount: '0', unpricedAttemptCount: '3' },
          estimates: [],
        }],
      }))}
      cloudConnectorCount={1}
      onOpenDetails={() => {}}
      onOpenCloud={() => {}}
    />,
  );
  assert.match(html, /data-testid="home-daily-spend-warning"/);
  assert.match(html, /Cost estimate unavailable/);
  assert.match(html, /Unpriced/);
  assert.doesNotMatch(html, /Local-only/);
});
