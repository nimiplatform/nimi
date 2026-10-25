import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DesktopAIExecutionRoute,
  DesktopAIExecutionState,
  type DesktopAIExecution,
  type DesktopAIUsageTotals,
} from '@nimiplatform/sdk/runtime/generated';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { SystemEntryDetailsView } from '../src/shell/renderer/features/system-entry/system-entry-details.js';
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
function completeUsageState(groupCount = 1): SystemEntryAIState {
  const ai = state();
  const summary = ai.usage.value!;
  summary.totals = { ...totals(String(groupCount)), pendingUsageCount: '0', measuredAttemptCount: String(groupCount), unpricedAttemptCount: '0' };
  summary.groupsComplete = true;
  summary.timeComplete = true;
  summary.quantityComplete = true;
  summary.partialReasons = [];
  summary.estimates = [{ currency: 'USD', estimatedAmount: '0.0117501', pricingBasis: 'captured_catalog_estimate' }];
  summary.groups = Array.from({ length: groupCount }, (_, index) => ({
    sourceKind: index % 2 === 0 ? 'home' : 'app', capability: 'text.generate',
    models: [{ ...model, modelId: `model-${index + 1}`, providerId: `provider-${index + 1}`, displayName: `Model ${index + 1}` }],
    route: index === 0 ? DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL : DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
    totals: { ...totals('1'), pendingUsageCount: '0', measuredAttemptCount: '1', unpricedAttemptCount: '0' }, estimates: [],
  }));
  return ai;
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
  assert.match(html, /0\.12/); assert.match(html, /0\.34/);
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

test('complete usage leads with totals and details while quiet zero exceptions stay out of the summary', async () => {
  await initI18n(); await changeLocale('en');
  const html = render('usage', completeUsageState());
  const summaryAt = html.indexOf('data-testid="home-usage-summary"');
  const groupsAt = html.indexOf('data-testid="home-usage-group"');
  const detailsAt = html.indexOf('data-testid="home-usage-data-details"');
  assert.ok(summaryAt >= 0 && summaryAt < groupsAt && groupsAt < detailsAt);
  assert.match(html, /data-testid="home-usage-attempts-card"/);
  assert.match(html, /data-testid="home-usage-cost-card"/);
  assert.match(html, /data-testid="home-usage-route-summary"/);
  assert.match(html, /data-testid="home-usage-coverage-status"/);
  assert.doesNotMatch(html, /home-usage-attention/);
  assert.doesNotMatch(html.slice(summaryAt, groupsAt), /Executions awaiting usage|Executions without a cost estimate/);
  assert.equal((html.match(/data-testid="home-usage-group"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Search models, providers or sources/);
  assert.match(html, /0\.0117501/);
  assert.match(html, /Counting and data coverage/);
});

test('pending measurements and unavailable prices stay visible and mark otherwise complete data partial', async () => {
  await initI18n(); await changeLocale('en');
  const ai = completeUsageState(2);
  ai.usage.value!.totals = { ...ai.usage.value!.totals!, pendingUsageCount: '1', measuredAttemptCount: '1', unpricedAttemptCount: '1' };
  const html = render('usage', ai);
  const attentionAt = html.indexOf('data-testid="home-usage-attention"');
  const groupsAt = html.indexOf('data-testid="home-usage-group"');
  assert.ok(attentionAt >= 0);
  const attention = html.slice(attentionAt, groupsAt);
  assert.match(attention, /Executions awaiting usage/);
  assert.match(attention, /Executions without a cost estimate/);
  assert.match(attention, />1<\/span>/);
  assert.match(html.slice(html.indexOf('data-testid="home-usage-data-details"')), /Partial/);
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

test('large usage groups support search, route filters, recovery and details without changing totals', async () => {
  await initI18n(); await changeLocale('en');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  const values: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in values)) values[name] = (dom.window as unknown as Record<string, unknown>)[name];
  }
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const groups = () => document.querySelectorAll('[data-testid="home-usage-group"]');
  const search = () => document.querySelector<HTMLInputElement>('input[aria-label="Search models, providers or sources"]')!;
  const setSearch = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
    search().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const clear = async () => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Clear filters')!;
    await act(async () => button.click());
  };
  try {
    await act(async () => root.render(<SystemEntryDetailsView section="usage" ai={completeUsageState(6)} onBack={() => {}} onSectionChange={() => {}} onRefresh={() => {}} />));
    assert.equal(groups().length, 6);
    const summary = document.querySelector('[data-testid="home-usage-summary"]')!.textContent;
    await setSearch('Model 1');
    assert.equal(groups().length, 1);
    assert.match(groups()[0]!.textContent ?? '', /Model 1/);
    await setSearch('no-such-model');
    assert.equal(groups().length, 0);
    assert.match(document.body.textContent ?? '', /No groups match the current filters/);
    await clear();
    assert.equal(groups().length, 6);
    const route = document.querySelector<HTMLSelectElement>('#home-usage-route-filter')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(route, 'local');
      route.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.equal(groups().length, 1);
    assert.match(groups()[0]!.textContent ?? '', /Model 1/);
    assert.equal(document.querySelector('[data-testid="home-usage-summary"]')!.textContent, summary);
    await setSearch('Model 2');
    assert.equal(groups().length, 0);
    await clear();
    assert.equal(groups().length, 6);
    await setSearch('Model 2');
    await act(async () => search().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(groups().length, 6);
    const details = document.querySelector<HTMLDetailsElement>('[data-testid="home-usage-data-details"]')!;
    assert.equal(details.open, false);
    await act(async () => details.querySelector('summary')!.click());
    assert.equal(details.open, true);
    assert.match(details.textContent ?? '', /Each actual AI execution attempt/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
