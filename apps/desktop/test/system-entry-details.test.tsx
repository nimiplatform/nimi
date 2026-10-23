import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DesktopAIExecutionRoute,
  DesktopAIExecutionState,
  type DesktopAIExecution,
  type DesktopAIUsageTotals,
} from '@nimiplatform/sdk/runtime/generated';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { HomeAIReadingEntries, SystemEntryDetailsView } from '../src/shell/renderer/features/system-entry/system-entry-details.js';
import type { SystemEntryAIState } from '../src/shell/renderer/features/system-entry/system-entry-ai-model.js';
import { systemEntryDayRange, systemEntryTimestamp } from '../src/shell/renderer/features/system-entry/system-entry-time.js';

(globalThis as { React?: typeof React }).React = React;
const now = Date.parse('2026-10-23T03:00:00Z');
const at = systemEntryTimestamp(now);
const range = systemEntryDayRange(now, 'Asia/Shanghai');
const source = { source: 'home', activityComplete: true, usageComplete: true };
const model = { modelId: 'actual-model', providerId: 'provider-a', displayName: 'Actual Model', role: 'primary' };

function execution(overrides: Partial<DesktopAIExecution> = {}): DesktopAIExecution {
  return { attemptId: 'attempt-1', parentWorkId: 'turn-1', parentWorkKind: 'agent-turn', sourceKind: 'local-agent', sourceId: 'agent-1', sourceLabel: 'My Agent',
    capability: 'text.generate', models: [model], route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
    state: DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING, startedAt: at, observedAt: at, ...overrides };
}
function totals(attemptCount = '12'): DesktopAIUsageTotals {
  return { attemptCount, activeAttemptCount: '0', pendingUsageCount: '1', measuredAttemptCount: '11', inputTokens: '35', outputTokens: '20',
    cachedInputTokens: '0', reasoningOutputTokens: '0', computeMs: '800', unpricedAttemptCount: '2' };
}
function state(): SystemEntryAIState {
  return {
    range,
    activity: { status: 'ready', error: null, value: { generationId: 'runtime', revision: '3', observedAt: at,
      executions: [execution()], sourceCoverage: [source], recordsComplete: true, knownActiveAttemptCount: '1', workCountKnown: true, knownWorkCount: '1', partialReasons: [] } },
    usage: { status: 'ready', error: null, value: { generationId: 'runtime', readAt: at, fromTime: range.fromTime, toTime: range.toTime, effectiveTo: at,
      totals: totals(), groups: [], groupsComplete: false, estimates: [], sourceCoverage: [source], sourceComplete: true, timeComplete: false, quantityComplete: false,
      coverageFrom: range.fromTime, coverageTo: at, partialReasons: ['unclean-generation'] } },
  };
}
function render(section: 'work' | 'usage', ai: SystemEntryAIState | null): string {
  return renderToStaticMarkup(<SystemEntryDetailsView section={section} ai={ai} onBack={() => {}} onSectionChange={() => {}} onRefresh={() => {}} />);
}

test('current work groups owner parents, shows actual models and keeps unknown execution read-only', async () => {
  await initI18n(); await changeLocale('en');
  const ai = state();
  ai.activity.value!.executions.push(
    execution({ attemptId: 'attempt-2', capability: 'image.generate', models: [{ ...model, modelId: 'image-model', displayName: 'Actual Image Model' }] }),
    execution({ attemptId: 'attempt-3', parentWorkId: '', parentWorkKind: '', state: DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_OBSERVATION_UNKNOWN }),
  );
  ai.activity.value!.workCountKnown = false;
  const html = render('work', ai);
  assert.equal((html.match(/data-testid="home-current-work-row"/g) ?? []).length, 2);
  assert.match(html, /Actual Model/); assert.match(html, /Actual Image Model/);
  assert.match(html, /Current status unconfirmed/); assert.match(html, /Reconnecting does not replay/);
  assert.match(html, /complete current work count is not confirmed/);
  assert.match(html, /No confirmed parent work association/);
  assert.doesNotMatch(html, /href=|continue-chat|open-activity/);
  assert.doesNotMatch(html, /runtimeConfig\.systemEntry/);
});

test('usage preserves precise counts, independent currencies and explicit partial coverage', async () => {
  await initI18n(); await changeLocale('en');
  const ai = state();
  const summary = ai.usage.value!;
  summary.totals = totals('9007199254740993');
  summary.estimates = [
    { currency: 'USD', estimatedAmount: '0.12', pricingBasis: 'captured_catalog_estimate' },
    { currency: 'EUR', estimatedAmount: '0.34', pricingBasis: 'catalog snapshot' },
  ];
  summary.groupsComplete = true;
  summary.groups = [
    { sourceKind: 'home', capability: 'text.generate', models: [model], route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL, totals: totals('9007199254740991'), estimates: [] },
    { sourceKind: 'app', capability: 'text.generate', models: [model], route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD, totals: totals('2'), estimates: summary.estimates },
  ];
  const html = render('usage', ai);
  assert.match(html, /9,007,199,254,740,993/);
  assert.match(html, /USD/); assert.match(html, /EUR/);
  assert.match(html, /Estimated 0\.12/); assert.match(html, /Estimated 0\.34/);
  assert.doesNotMatch(html, /0\.46/);
  assert.match(html, /Partial/); assert.match(html, /Missing sources, gaps, pending usage/);
  assert.match(html, /not a provider bill/); assert.match(html, /never added together/);
  assert.match(html, /Catalog price captured for the execution/);
  assert.match(html, /Asia\/Shanghai/);
  await changeLocale('zh');
  const chinese = render('usage', ai);
  assert.match(chinese, /今日用量/); assert.match(chinese, /不是供应商账单/); assert.match(chinese, /部分/);
  assert.doesNotMatch(chinese, /runtimeConfig\.systemEntry/);
});

test('unavailable or incomplete empty reads never revive old models or fabricate complete zero', async () => {
  await initI18n(); await changeLocale('en');
  const ai = state();
  const stale = { ...ai, activity: { ...ai.activity, status: 'unavailable' as const } };
  assert.match(render('work', stale), /does not mean work has stopped/);
  assert.doesNotMatch(render('work', stale), /Actual Model/);
  ai.activity.value!.executions = [];
  ai.activity.value!.sourceCoverage = [];
  ai.activity.value!.workCountKnown = false;
  assert.match(render('work', ai), /No execution records have arrived/);
  assert.doesNotMatch(render('work', ai), /Current work: 0/);
  const unavailable = { ...ai, usage: { status: 'unavailable' as const, value: null, error: 'owner unavailable' } };
  assert.match(render('usage', unavailable), /No request count or cost is assumed to be zero/);
  assert.doesNotMatch(render('usage', unavailable), /Estimated 0|Recorded AI executions<\/dt>/);
});

test('Home exposes distinct current-work and usage reading entries', async () => {
  await initI18n(); await changeLocale('zh');
  const html = renderToStaticMarkup(<HomeAIReadingEntries onOpenWork={() => {}} onOpenUsage={() => {}} />);
  assert.match(html, /data-testid="home-work-entry"/);
  assert.match(html, /data-testid="home-usage-entry"/);
  assert.match(html, /正在进行/); assert.match(html, /今日用量/);
});
