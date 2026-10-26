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
function render(ai: SystemEntryAIState | null): string {
  return renderToStaticMarkup(<SystemEntryDetailsView ai={ai} onBack={() => {}} onRefresh={() => {}} />);
}

test('one page shows independent work and daily execution counts with separate timestamps', async () => {
  await initI18n(); await changeLocale('en');
  const ai = completeUsageState(3);
  ai.activity.value!.executions.push(execution({ attemptId: 'retry', startedAt: systemEntryTimestamp(now - 86_400_000) }));
  ai.activity.value!.observedAt = systemEntryTimestamp(now - 60_000);
  const document = JSDOM.fragment(render(ai));
  assert.equal(document.querySelector('h1')!.textContent, 'AI activity & usage');
  assert.equal(document.querySelector('nav'), null);
  assert.equal(document.querySelectorAll('[data-testid="home-current-work-row"]').length, 1);
  assert.match(document.querySelector('[data-testid="home-current-work-summary"]')!.textContent!, /1work items/);
  assert.match(document.querySelector('[data-testid="home-usage-attempts-card"] dd')!.textContent!, /3executions/);
  const activity = document.querySelector('[data-testid="home-current-work-reading"]')!;
  assert.equal(activity.querySelector('time')!.getAttribute('datetime'), new Date(now - 60_000).toISOString());
  assert.ok([...activity.querySelectorAll('time')].some(time => time.getAttribute('datetime') === new Date(now - 86_400_000).toISOString()));
  assert.equal(document.querySelector('[data-testid="home-ai-usage-reading"] time')!.getAttribute('datetime'), new Date(now).toISOString());
  assert.equal(document.querySelectorAll('table thead th').length, 5);
  assert.equal(document.querySelectorAll('table tbody tr').length, 3);
});

test('current work groups owner parents, shows actual models and keeps unknown execution read-only', async () => {
  await initI18n(); await changeLocale('en');
  const ai = state();
  ai.activity.value!.executions.push(
    execution({ attemptId: 'attempt-2', capability: 'image.generate', models: [{ ...model, modelId: 'image-model', displayName: 'Actual Image Model' }] }),
    execution({ attemptId: 'attempt-3', parentWorkId: '', parentWorkKind: '', state: DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_OBSERVATION_UNKNOWN }),
  );
  ai.activity.value!.workCountKnown = false;
  const html = render(ai);
  assert.equal((html.match(/data-testid="home-current-work-row"/g) ?? []).length, 2);
  assert.match(html, /Actual Model/); assert.match(html, /Actual Image Model/);
  assert.match(html, /Current status unconfirmed/); assert.match(html, /Reconnecting does not replay/);
  assert.match(html, /complete current work count is not confirmed/);
  assert.match(html, /No confirmed parent work association/);
  assert.doesNotMatch(html, /href=|continue-chat|open-activity/);
  assert.doesNotMatch(html, /runtimeConfig\.systemEntry/);
});

test('usage preserves precise counts, independent currencies and explains missing records', async () => {
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
  const html = render(ai);
  assert.match(html, /9,007,199,254,740,993/);
  assert.match(html, /USD/); assert.match(html, /EUR/);
  assert.match(html, /0\.12/); assert.match(html, /0\.34/);
  assert.doesNotMatch(html, /0\.46/);
  assert.match(html, /displayed count may be lower/); assert.match(html, /Cost estimate is incomplete/);
  assert.match(html, /not a provider bill/); assert.match(html, /never added together/);
  assert.match(html, /Asia\/Shanghai/);
  await changeLocale('zh');
  const chinese = render(ai);
  assert.match(chinese, /今日用量/); assert.match(chinese, /不是供应商账单/); assert.match(chinese, /显示次数可能少于实际执行次数/);
  assert.doesNotMatch(chinese, /runtimeConfig\.systemEntry/);
});

test('complete usage keeps only concise explanations and hides normal coverage checks', async () => {
  await initI18n(); await changeLocale('en');
  const html = render(completeUsageState());
  const summaryAt = html.indexOf('data-testid="home-usage-summary"');
  const groupsAt = html.indexOf('data-testid="home-usage-group"');
  const detailsAt = html.indexOf('data-testid="home-usage-data-details"');
  assert.ok(summaryAt >= 0 && summaryAt < groupsAt && groupsAt < detailsAt);
  assert.match(html, /data-testid="home-usage-attempts-card"/);
  assert.match(html, /data-testid="home-usage-cost-card"/);
  assert.match(html, /data-testid="home-usage-route-summary"/);
  assert.doesNotMatch(html, /home-usage-(coverage-status|count-warning|cost-warning|details-warning)/);
  assert.doesNotMatch(html, /Executions awaiting usage|Executions without a cost estimate|Execution source coverage|Recorded range|Time through the last read|Reported usage quantities|Not fully covered/);
  assert.equal((html.match(/data-testid="home-usage-group"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Search models, providers or sources/);
  assert.match(html, /0\.0117501/);
  assert.match(html, /About these numbers/);
  assert.doesNotMatch(html, /general API requests|Currencies are shown separately/);
  const explanation = JSDOM.fragment(html).querySelector('[data-testid="home-usage-data-details"]')!;
  assert.equal(explanation.querySelectorAll('section').length, 2);
  assert.equal(explanation.hasAttribute('open'), false);
  assert.equal(explanation.querySelector('dl, [role="status"]'), null);
});

test('pending measurements and unavailable prices warn only beside costs without repeating in explanations', async () => {
  await initI18n(); await changeLocale('en');
  const ai = completeUsageState(2);
  ai.usage.value!.totals = { ...ai.usage.value!.totals!, pendingUsageCount: '1', measuredAttemptCount: '1', unpricedAttemptCount: '1' };
  const html = render(ai);
  const document = JSDOM.fragment(html);
  const warning = document.querySelector('[data-testid="home-usage-cost-card"] [data-testid="home-usage-cost-warning"]');
  assert.match(warning?.textContent ?? '', /Executions awaiting usage: 1/);
  assert.match(warning?.textContent ?? '', /Executions without a cost estimate: 1/);
  assert.match(warning?.textContent ?? '', /Unknown costs are not counted as zero/);
  assert.equal(document.querySelector('[data-testid="home-usage-count-warning"], [data-testid="home-usage-details-warning"]'), null);
  assert.doesNotMatch(document.querySelector('[data-testid="home-usage-data-details"]')!.textContent ?? '', /incomplete|awaiting|cannot yet/);
});

test('each incomplete dimension warns only about the affected numbers', async () => {
  await initI18n(); await changeLocale('en');
  type Summary = NonNullable<SystemEntryAIState['usage']['value']>;
  const cases: Array<{ name: string; change(summary: Summary): void; warnings: string[]; text: RegExp }> = [
    { name: 'missing source', change: summary => {
      summary.sourceComplete = false;
      summary.sourceCoverage.push({ source: 'app', activityComplete: true, usageComplete: false });
    }, warnings: ['count', 'cost'], text: /Not fully recorded: Apps/ },
    { name: 'missing source coverage', change: summary => { summary.sourceCoverage = []; }, warnings: ['count', 'cost'], text: /displayed count may be lower/ },
    { name: 'time gap', change: summary => { summary.timeComplete = false; }, warnings: ['count', 'cost'], text: /Recorded range \(may contain gaps\)/ },
    { name: 'pending usage', change: summary => {
      summary.quantityComplete = false; summary.totals!.pendingUsageCount = '1'; summary.partialReasons = ['usage_pending'];
    }, warnings: ['cost'], text: /Executions awaiting usage: 1/ },
    { name: 'missing quantities', change: summary => { summary.quantityComplete = false; }, warnings: ['cost'], text: /Some billing quantities are missing/ },
    { name: 'missing prices', change: summary => {
      summary.totals!.unpricedAttemptCount = '1'; summary.partialReasons = ['unpriced_usage'];
    }, warnings: ['cost'], text: /Executions without a cost estimate: 1/ },
    { name: 'invalid estimate', change: summary => {
      summary.estimates.push({ currency: 'USD', estimatedAmount: 'unknown', pricingBasis: '' });
    }, warnings: ['cost'], text: /Some cost data cannot be confirmed/ },
    { name: 'bounded groups', change: summary => { summary.groupsComplete = false; }, warnings: ['details'], text: /local and cloud counts are unavailable/ },
    { name: 'groups do not reconcile', change: summary => { summary.groups = summary.groups.slice(0, 1); }, warnings: ['details'], text: /Total executions and costs are still shown from their separate summary records/ },
    { name: 'unclassified coverage', change: summary => { summary.partialReasons = ['unconfirmed']; }, warnings: ['count', 'cost'], text: /Execution record coverage is not confirmed/ },
  ];
  for (const scenario of cases) {
    const ai = completeUsageState(2);
    scenario.change(ai.usage.value!);
    const document = JSDOM.fragment(render(ai));
    for (const dimension of ['count', 'cost', 'details']) {
      assert.equal(Boolean(document.querySelector(`[data-testid="home-usage-${dimension}-warning"]`)), scenario.warnings.includes(dimension), `${scenario.name}: ${dimension}`);
    }
    assert.match(document.textContent ?? '', scenario.text, scenario.name);
    assert.match(document.querySelector('[data-testid="home-usage-attempts-card"] dd')!.textContent ?? '', /^2executions$/);
    assert.match(document.querySelector('[data-testid="home-usage-cost-card"]')!.textContent ?? '', /0\.0117501/);
    assert.doesNotMatch(document.querySelector('[data-testid="home-usage-data-details"]')!.textContent ?? '', /Recorded range|coverage|incomplete|Not fully recorded/);
    assert.doesNotMatch(document.textContent ?? '', /runtimeConfig\.systemEntry/);
  }
});

test('empty complete usage stays quiet while missing details never imply a zero total', async () => {
  await initI18n(); await changeLocale('en');
  const empty = completeUsageState(0);
  empty.usage.value!.estimates = [];
  const emptyHtml = render(empty);
  assert.match(emptyHtml, /No AI executions are recorded/);
  assert.doesNotMatch(emptyHtml, /home-usage-(count|cost|details)-warning|Recorded range|Execution source coverage/);
  const missingGroups = completeUsageState(1);
  missingGroups.usage.value!.groups = [];
  const html = render(missingGroups);
  assert.match(html, /home-usage-details-warning/);
  assert.doesNotMatch(html, /No AI executions are recorded|home-usage-count-warning|home-usage-cost-warning/);
});

test('unavailable or incomplete empty reads never revive old models or fabricate complete zero', async () => {
  await initI18n(); await changeLocale('en');
  const ai = state();
  const stale = { ...ai, activity: { ...ai.activity, status: 'unavailable' as const } };
  assert.match(render(stale), /does not mean work has stopped/);
  assert.doesNotMatch(render(stale), /Actual Model/);
  ai.activity.value!.executions = [];
  ai.activity.value!.sourceCoverage = [];
  ai.activity.value!.workCountKnown = false;
  assert.match(render(ai), /No execution records have arrived/);
  assert.doesNotMatch(render(ai), /Current work: 0/);
  const unavailable = { ...ai, usage: { status: 'unavailable' as const, value: null, error: 'owner unavailable' } };
  assert.match(render(unavailable), /No request count or cost is assumed to be zero/);
  assert.doesNotMatch(render(unavailable), /Estimated 0|Recorded AI executions<\/dt>/);
});

test('independent loading, unavailable and invalid readers never hide the healthy reader', async () => {
  await initI18n(); await changeLocale('en');
  for (const status of ['loading', 'unavailable'] as const) {
    const ai = completeUsageState();
    ai.activity.status = status;
    const document = JSDOM.fragment(render(ai));
    assert.equal(document.querySelectorAll('[data-testid="home-current-work-row"]').length, 0);
    assert.equal(document.querySelectorAll('[data-testid="home-usage-group"]').length, 1);
    assert.match(document.querySelector('[data-testid="home-usage-cost-card"]')!.textContent!, /0\.0117501/);
    ai.activity.status = 'ready';
    ai.usage.status = status;
    const reversed = JSDOM.fragment(render(ai));
    assert.equal(reversed.querySelectorAll('[data-testid="home-current-work-row"]').length, 1);
    assert.equal(reversed.querySelectorAll('[data-testid="home-usage-group"]').length, 0);
    assert.doesNotMatch(reversed.textContent!, /0\.0117501|Model 1/);
  }
  const invalid = completeUsageState();
  invalid.usage.value!.totals!.attemptCount = 'unconfirmed';
  assert.match(JSDOM.fragment(render(invalid)).textContent!, /Today's AI usage cannot be confirmed/);
  assert.match(render(invalid), /Actual Model/);
  invalid.activity.value!.knownWorkCount = '0';
  assert.match(render(invalid), /complete current work count is not confirmed/);
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
    await act(async () => root.render(<SystemEntryDetailsView ai={completeUsageState(6)} onBack={() => {}} onRefresh={() => {}} />));
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
    assert.match(details.textContent ?? '', /Each actual AI execution counts once/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
