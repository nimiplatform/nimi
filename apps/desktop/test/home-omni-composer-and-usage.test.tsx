import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DesktopAIExecutionRoute,
  type DesktopAIUsageSummary,
} from '@nimiplatform/sdk/runtime/generated';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { SystemEntryAIState } from '../src/shell/renderer/features/system-entry/system-entry-ai-model.js';
import { systemEntryDayRange } from '../src/shell/renderer/features/system-entry/system-entry-time.js';

function installDomGlobals(t: test.TestContext) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: ResizeObserverStub,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => (previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key)));
  }
  t.after(() => dom.window.close());
  return dom;
}

function makeUsageAI(overrides: Partial<DesktopAIUsageSummary> = {}): SystemEntryAIState {
  const range = systemEntryDayRange(Date.UTC(2026, 10, 28, 4, 0, 0), 'Asia/Shanghai');
  const summary: DesktopAIUsageSummary = {
    generationId: 'gen-1',
    fromTime: range.fromTime,
    toTime: range.toTime,
    effectiveTo: range.toTime,
    readAt: range.toTime,
    coverageFrom: range.fromTime,
    coverageTo: range.toTime,
    sourceComplete: true,
    timeComplete: true,
    quantityComplete: true,
    groupsComplete: true,
    partialReasons: [],
    sourceCoverage: [{ source: 'home', activityComplete: true, usageComplete: true }],
    totals: {
      attemptCount: '0',
      activeAttemptCount: '0',
      pendingUsageCount: '0',
      measuredAttemptCount: '0',
      inputTokens: '0',
      outputTokens: '0',
      cachedInputTokens: '0',
      reasoningOutputTokens: '0',
      computeMs: '0',
      unpricedAttemptCount: '0',
    },
    estimates: [],
    groups: [],
    ...overrides,
  };
  return {
    range,
    activity: { status: 'ready', value: null, error: null },
    usage: { status: 'ready', value: summary, error: null },
  };
}

test('HomeOmniComposer normalizes @ handle prefixes and renders empty-state popovers for @, ~, and # triggers', async (t) => {
  const dom = installDomGlobals(t);
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { HomeOmniComposer } = await import('../src/shell/renderer/features/home/home-omni-composer.js');

  await initI18n();
  await changeLocale('en');

  const bindings = {
    app: { commands: {} },
    sdk: {
      accountProduct: () => ({
        sessions: {
          listSessions: async () => ({ items: [] }),
        },
      }),
    },
  } as unknown as DesktopCanonicalRendererBindings;

  const doc = dom.window.document;
  const root = createRoot(doc.getElementById('root')!);
  let exploreCalls = 0;

  const setInputValue = async (input: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
      input.setSelectionRange(value.length, value.length);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };

  try {
    await act(async () => {
      root.render(
        <DesktopRendererBindingProvider bindings={bindings}>
          <HomeOmniComposer
            accountKey="acct-omni-fix"
            partners={[]}
            partnersLoaded
            humanContacts={[
              { contactId: 'u-eric', displayName: 'Eric', handle: '@eric' },
              { contactId: 'u-alice', displayName: 'Alice', handle: 'alice' },
              { contactId: 'u-plain', displayName: 'Plain Friend', handle: null },
            ]}
            recentSessions={[]}
            onOpenHarness={() => {}}
            onOpenModelSwitch={() => {}}
            onOpenHumanChatDraft={() => {}}
            onOpenPartnerZhiyu={() => {}}
            onExplorePartners={() => { exploreCalls += 1; }}
          />
        </DesktopRendererBindingProvider>,
      );
    });

    const input = doc.querySelector<HTMLTextAreaElement>('[data-testid="home-quick-start-input"]')!;

    // OBS-001: @ Friend popover normalizes handle prefix so @eric never becomes @@eric.
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-hint:human"]')!.click();
    });
    const humanPopover = doc.querySelector('[data-testid="home-omni-trigger-popover:human"]');
    assert.ok(humanPopover, '@ trigger should open human popover');
    assert.match(humanPopover.textContent ?? '', /@eric/);
    assert.doesNotMatch(humanPopover.textContent ?? '', /@@eric/);
    assert.match(humanPopover.textContent ?? '', /@alice/);
    assert.match(humanPopover.textContent ?? '', /Friend/);

    // Unmatched @ query shows lightweight empty-state item instead of hiding popover silently.
    await setInputValue(input, '@nobody-matches');
    const humanEmpty = doc.querySelector('[data-testid="home-omni-trigger-empty:human"]');
    assert.ok(humanEmpty, 'unmatched @ query should show empty-state item');
    assert.match(humanEmpty.textContent ?? '', /No matching friends/);

    // OBS-002: Clicking ~ Partner on 0 partners opens empty-state popover with Discover partners CTA.
    await setInputValue(input, '');
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-hint:partner"]')!.click();
    });
    const partnerPopover = doc.querySelector('[data-testid="home-omni-trigger-popover:partner"]');
    const partnerEmpty = doc.querySelector('[data-testid="home-omni-trigger-empty:partner"]');
    assert.ok(partnerPopover && partnerEmpty, '~ trigger with 0 partners should mount empty-state popover');
    assert.match(partnerEmpty.textContent ?? '', /No partners on this device yet/);
    const discoverBtn = doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-trigger-empty-discover-partners"]');
    assert.ok(discoverBtn, 'empty partner popover should offer Discover partners CTA');
    await act(async () => {
      discoverBtn.click();
    });
    assert.equal(exploreCalls, 1);
    assert.equal(input.value, '');

    // OBS-002: Clicking # Past on 0 sessions opens empty-state popover and Escape dismisses it.
    await act(async () => {
      doc.querySelector<HTMLButtonElement>('[data-testid="home-omni-hint:session"]')!.click();
    });
    const sessionEmpty = doc.querySelector('[data-testid="home-omni-trigger-empty:session"]');
    assert.ok(sessionEmpty, '# trigger with 0 sessions should mount empty-state popover');
    assert.match(sessionEmpty.textContent ?? '', /No past sessions yet/);
    await act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(doc.querySelector('[data-testid="home-omni-trigger-popover:session"]'), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test('HomeAmbientStatusStrip preserves (i) uncertainty on incomplete zero coverage without claiming cost pending or $0.00', async (t) => {
  installDomGlobals(t);
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { HomeAmbientStatusStrip } = await import('../src/shell/renderer/features/home/home-ambient-status-strip.js');

  await initI18n();
  const noop = () => {};
  const renderStrip = (ai: SystemEntryAIState) => renderToStaticMarkup(
    <TooltipProvider>
      <HomeAmbientStatusStrip
        runtime="ready"
        capabilitiesLoading={false}
        capabilitiesFailed={false}
        readyCapabilityCount={0}
        ai={ai}
        remote={{ primaryState: 'this-pc', remoteEnabled: false, connectedClientCount: 0, pendingConfirmCount: 0 }}
        activeIntegrationCount={0}
        onOpenDiagnostics={noop}
        onOpenCapabilities={noop}
        onOpenUsageDetails={noop}
        onOpenConnections={noop}
        onOpenIntegrations={noop}
      />
    </TooltipProvider>,
  );

  // Incomplete coverage with 0 attempts: keep (i) per home-ai-coverage, never say cost pending or $0.00.
  const incompleteZero = makeUsageAI({ timeComplete: false, partialReasons: ['unclean-generation'] });
  await changeLocale('en');
  const enIncomplete = renderStrip(incompleteZero);
  assert.match(enIncomplete, /0 calls recorded · coverage incomplete/);
  assert.match(enIncomplete, /data-testid="home-ambient-usage-incomplete"/);
  assert.doesNotMatch(enIncomplete, /cost pending|\$0\.00/i);

  await changeLocale('zh');
  const zhIncomplete = renderStrip(incompleteZero);
  assert.match(zhIncomplete, /今日记录 0 次 · 统计不完整/);
  assert.match(zhIncomplete, /data-testid="home-ambient-usage-incomplete"/);
  assert.doesNotMatch(zhIncomplete, /费用待确认|\$0\.00/);

  // Complete zero coverage: calm wording without (i).
  const completeZero = makeUsageAI();
  await changeLocale('en');
  const enComplete = renderStrip(completeZero);
  assert.match(enComplete, /No calls today/);
  assert.doesNotMatch(enComplete, /data-testid="home-ambient-usage-incomplete"/);
  assert.doesNotMatch(enComplete, /cost pending|\$0\.00/i);

  await changeLocale('zh');
  const zhComplete = renderStrip(completeZero);
  assert.match(zhComplete, /今日未调用/);
  assert.doesNotMatch(zhComplete, /data-testid="home-ambient-usage-incomplete"/);
});

test('SystemEntryDetailsView replaces misleading Cost estimate unavailable on 0 attempts while keeping coverage warnings', async (t) => {
  installDomGlobals(t);
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { SystemEntryDetailsView } = await import('../src/shell/renderer/features/system-entry/system-entry-details.js');

  await initI18n();
  const renderDetails = (ai: SystemEntryAIState) => renderToStaticMarkup(
    <TooltipProvider>
      <SystemEntryDetailsView ai={ai} onBack={() => {}} onRefresh={() => {}} />
    </TooltipProvider>,
  );

  // Incomplete coverage with 0 attempts: honest copy + keep both count and cost (i) warnings.
  const incompleteZero = makeUsageAI({ sourceComplete: false, sourceCoverage: [{ source: 'app', activityComplete: true, usageComplete: false }] });
  await changeLocale('en');
  const enIncomplete = JSDOM.fragment(renderDetails(incompleteZero));
  const enIncompleteCost = enIncomplete.querySelector('[data-testid="home-usage-cost-card"]')!;
  assert.match(enIncompleteCost.textContent ?? '', /No recorded costs · coverage incomplete/);
  assert.doesNotMatch(enIncompleteCost.textContent ?? '', /Cost estimate unavailable|\$0\.00/);
  assert.ok(enIncomplete.querySelector('[data-testid="home-usage-count-warning"]'));
  assert.ok(enIncomplete.querySelector('[data-testid="home-usage-cost-warning"]'));

  await changeLocale('zh');
  const zhIncomplete = JSDOM.fragment(renderDetails(incompleteZero));
  const zhIncompleteCost = zhIncomplete.querySelector('[data-testid="home-usage-cost-card"]')!;
  assert.match(zhIncompleteCost.textContent ?? '', /暂无记录费用 · 统计不完整/);
  assert.doesNotMatch(zhIncompleteCost.textContent ?? '', /费用暂无法估算|\$0\.00/);
  assert.ok(zhIncomplete.querySelector('[data-testid="home-usage-cost-warning"]'));

  // Complete 0 attempts: calm copy without warnings.
  const completeZero = makeUsageAI();
  await changeLocale('en');
  const enComplete = JSDOM.fragment(renderDetails(completeZero));
  assert.match(enComplete.querySelector('[data-testid="home-usage-cost-card"]')!.textContent ?? '', /No calls today/);
  assert.doesNotMatch(enComplete.querySelector('[data-testid="home-usage-cost-card"]')!.textContent ?? '', /Cost estimate unavailable/);
  assert.equal(enComplete.querySelector('[data-testid="home-usage-cost-warning"]'), null);

  // Non-zero unpriced cloud attempts still fail closed with Cost estimate unavailable.
  const unpricedCloud = makeUsageAI({
    totals: {
      attemptCount: '2',
      activeAttemptCount: '0',
      pendingUsageCount: '0',
      measuredAttemptCount: '2',
      inputTokens: '10',
      outputTokens: '10',
      cachedInputTokens: '0',
      reasoningOutputTokens: '0',
      computeMs: '100',
      unpricedAttemptCount: '2',
    },
    groups: [{
      sourceKind: 'home',
      capability: 'text.generate',
      models: [{ modelId: 'cloud-1', providerId: 'openai', displayName: 'Cloud 1', role: 'primary' }],
      route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
      totals: {
        attemptCount: '2',
        activeAttemptCount: '0',
        pendingUsageCount: '0',
        measuredAttemptCount: '2',
        inputTokens: '10',
        outputTokens: '10',
        cachedInputTokens: '0',
        reasoningOutputTokens: '0',
        computeMs: '100',
        unpricedAttemptCount: '2',
      },
      estimates: [],
    }],
  });
  const enUnpriced = JSDOM.fragment(renderDetails(unpricedCloud));
  assert.match(enUnpriced.querySelector('[data-testid="home-usage-cost-card"] dd')!.textContent ?? '', /Cost estimate unavailable/);
});
