import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { DesktopAIUsageSummary, ListDesktopConnectorReferencesResponse } from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';

async function withCloudRenderer(sdk: unknown, run: (ui: {
  document: Document;
  components: typeof import('../src/shell/renderer/features/runtime-config/runtime-config-cloud-observation.js');
  render(element: React.ReactElement): Promise<void>;
  settle(): Promise<void>;
  account(id: string): Promise<void>;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    CustomEvent: dom.window.CustomEvent, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  // Load portal owners after the DOM exists so Radix initializes its client effects.
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const components = await import('../src/shell/renderer/features/runtime-config/runtime-config-cloud-observation.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.setState(state => ({ auth: { ...state.auth, status: 'authenticated', user: { id: 'account-a' } } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
  const bindings = { sdk, app: { commands: {} } } as DesktopCanonicalRendererBindings;
  try {
    await run({ document: dom.window.document, components,
      render: element => act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}><I18nextProvider i18n={i18n}><DesktopMotionProvider><DesktopRendererBindingProvider bindings={bindings}>{element}</DesktopRendererBindingProvider></DesktopMotionProvider></I18nextProvider></AppStoreProvider></QueryClientProvider>)),
      settle: () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }),
      account: id => act(async () => { store.setState(state => ({ auth: { ...state.auth, user: { id } } })); }),
    });
  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

function usage(): DesktopAIUsageSummary {
  return { generationId: 'generation', readAt: undefined, fromTime: undefined, toTime: undefined, effectiveTo: undefined,
    totals: { attemptCount: '0', activeAttemptCount: '0', pendingUsageCount: '0', measuredAttemptCount: '0', inputTokens: '0', outputTokens: '0', cachedInputTokens: '0', reasoningOutputTokens: '0', computeMs: '0', unpricedAttemptCount: '1' },
    groups: [], groupsComplete: true, estimates: [{ currency: 'USD', estimatedAmount: '1.25', pricingBasis: 'catalog' }, { currency: 'EUR', estimatedAmount: '2.5', pricingBasis: 'catalog' }], sourceCoverage: [],
    sourceComplete: false, timeComplete: false, quantityComplete: false, attributionComplete: false, coverageFrom: undefined, coverageTo: undefined, partialReasons: ['connector_attribution_incomplete'] };
}

test('connection usage preserves uncertainty and refreshes within the same second', async context => {
  context.mock.method(Date, 'now', () => 1_800_000_000_000);
  let reads = 0;
  let request: Record<string, unknown> | undefined;
  const sdk = { accountProduct: () => ({ audit: { getDesktopAIUsageSummary: async (value: Record<string, unknown>) => { reads++; request = value; return { summary: usage() }; } } }) };
  await withCloudRenderer(sdk, async ui => {
    await ui.render(<ui.components.CloudConnectorUsage connectorId="exact-connection" onOpenHistory={() => {}} />); await ui.settle();
    assert.equal(request?.connectorRef, 'exact-connection');
    assert.equal('accountId' in request!, false);
    const text = ui.document.querySelector('[data-testid="cloud-usage-summary"]')!.textContent!;
    assert.match(text, /—/);
    assert.match(text, /USD 1.25/); assert.match(text, /EUR 2.5/);
    assert.doesNotMatch(text, /3.75/);
    assert.match(text, /partialUsage/); assert.match(text, /unmeasured/);
    const refresh = Array.from(ui.document.querySelectorAll('button')).find(button => button.textContent?.includes('runtimeConfig.runtime.refresh'));
    assert.ok(refresh);
    await act(async () => refresh.click());
    await ui.settle();
    assert.equal(reads, 2);
  });
});

test('connection history refreshes within the same second and requires both coverage facts for an empty claim', async context => {
  context.mock.method(Date, 'now', () => 1_800_000_000_000);
  let attributionComplete = false;
  let reads = 0;
  const sdk = { accountProduct: () => ({ audit: {
    listDesktopAICloudHistory: async () => {
      reads++;
      return { attempts: [], nextPageToken: '', recordsComplete: true, attributionComplete };
    },
  } }) };
  await withCloudRenderer(sdk, async ui => {
    await ui.render(<ui.components.CloudHistoryDialog connectorId="exact-connection" onClose={() => {}} />);
    await ui.settle();
    assert.match(ui.document.body.textContent!, /partialHistory/);
    assert.match(ui.document.body.textContent!, /historyNotObserved/);
    assert.doesNotMatch(ui.document.body.textContent!, /historyEmpty/);

    attributionComplete = true;
    const refresh = Array.from(ui.document.querySelectorAll('button')).find(button => button.textContent?.includes('runtimeConfig.runtime.refresh'));
    assert.ok(refresh);
    await act(async () => refresh.click());
    await ui.settle();
    assert.equal(reads, 2);
    assert.match(ui.document.body.textContent!, /historyEmpty/);
    assert.doesNotMatch(ui.document.body.textContent!, /partialHistory|historyNotObserved/);
  });
});

test('reference reads reject missing observation metadata instead of showing no references', async () => {
  const sdk = { machineProduct: () => ({ apps: {} }), accountProduct: () => ({ configurationReferences: { listDesktopConnectorReferences: async () => ({ references: [], snapshotRevision: '', nextPageToken: '' }) } }) };
  await withCloudRenderer(sdk, async ui => {
    await ui.render(<ui.components.CloudConnectorReferences connectorId="connection" compact />); await ui.settle();
    assert.ok(ui.document.querySelector('[role="alert"]'));
    assert.doesNotMatch(ui.document.body.textContent!, /noReferences/);
  });
});

test('late reference results from an old account do not appear in the next account', async () => {
  const reads: ((value: ListDesktopConnectorReferencesResponse) => void)[] = [];
  const sdk = { machineProduct: () => ({ apps: {} }), accountProduct: () => ({ configurationReferences: { listDesktopConnectorReferences: () => new Promise<ListDesktopConnectorReferencesResponse>(resolve => reads.push(resolve)) } }) };
  await withCloudRenderer(sdk, async ui => {
    await ui.render(<ui.components.CloudConnectorReferences connectorId="connection" compact />);
    await ui.account('account-b');
    await act(async () => reads[0]!({ references: [{ owner: { owner: { oneofKind: 'app', app: { appId: 'private-owner-a' } } }, capabilityContract: 'text.generate', implementationId: 'impl', configRevision: '1' }], snapshotRevision: 'old', nextPageToken: '', observedAt: { seconds: '1000', nanos: 0 } }));
    await ui.settle();
    assert.doesNotMatch(ui.document.body.textContent!, /private-owner-a/);
    await act(async () => reads[1]!({ references: [], snapshotRevision: 'new', nextPageToken: '', observedAt: { seconds: '1001', nanos: 0 } }));
    await ui.settle();
    assert.match(ui.document.body.textContent!, /noReferences/);
  });
});

test('reference pages from different observations are never combined into a complete impact list', async () => {
  let reads = 0;
  const sdk = { machineProduct: () => ({ apps: {} }), accountProduct: () => ({ configurationReferences: {
    listDesktopConnectorReferences: async () => {
      const first = reads++ === 0;
      return { references: [{ owner: { owner: { oneofKind: 'app', app: { appId: first ? 'owner-first' : 'owner-changed' } } }, capabilityContract: 'text.generate', implementationId: 'impl', configRevision: '1' }],
        snapshotRevision: first ? 'first-revision' : 'changed-revision', nextPageToken: first ? 'next' : '', observedAt: { seconds: '1000', nanos: 0 } };
    },
  } }) };
  await withCloudRenderer(sdk, async ui => {
    await ui.render(<ui.components.CloudConnectorReferences connectorId="connection" compact />); await ui.settle();
    assert.match(ui.document.body.textContent!, /owner-first/);
    const more = Array.from(ui.document.querySelectorAll('button')).find(button => button.textContent?.includes('loadMore'));
    assert.ok(more);
    await act(async () => more.click()); await ui.settle();
    assert.ok(ui.document.querySelector('[role="alert"]'));
    assert.doesNotMatch(ui.document.body.textContent!, /owner-first|owner-changed|noReferences/);
  });
});
