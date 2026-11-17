import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import { I18nextProvider } from 'react-i18next';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { i18n, initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion-context.js';
import { CloudServicesPage } from '../src/shell/renderer/features/runtime-config/runtime-config-page-cloud.js';
import { RuntimeConfigConnectorSdkProvider } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-context.js';
import type { RuntimeConfigConnectorSdkService } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.js';
import type { RuntimeConfigPanelControllerModel } from '../src/shell/renderer/features/runtime-config/runtime-config-panel-types.js';
import { normalizeConnectorV11, type ApiConnector, type RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';

test('Cloud distinguishes loading, list failure, stale rows, and confirmed empty', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollTo', { value: () => {} });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  await initI18n();
  await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  await store.navigation.push({ id: 'cloud' });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const reads: { resolve: (rows: ApiConnector[]) => void; reject: (error: Error) => void }[] = [];
  const sdk = {
    sdkListProviderCatalog: async () => [],
    sdkListConnectors: () => new Promise<ApiConnector[]>((resolve, reject) => reads.push({ resolve, reject })),
  } as unknown as RuntimeConfigConnectorSdkService;
  const bindings = {
    sdk: {}, app: { commands: { connectorAuth: {} }, projection: { developerModeEnabled: () => false } },
    clock: { now: Date.now },
  } as unknown as DesktopCanonicalRendererBindings;
  const staleConnector = normalizeConnectorV11({ id: 'previous', label: 'Previously read connector', hasCredential: false });
  function Arrange({ cached }: { cached: boolean }) {
    const [state, updateState] = useState<RuntimeConfigStateV11>(() => ({
      connectors: cached ? [staleConnector] : [],
    }) as RuntimeConfigStateV11);
    const model = {
      selectedConnector: null, orderedConnectors: state.connectors, updateState, checkingConnector: null,
    } as unknown as RuntimeConfigPanelControllerModel;
    return <CloudServicesPage model={model} state={state} />;
  }
  const render = (cached: boolean) => act(async () => root.render(
    <I18nextProvider i18n={i18n}><AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}>
      <RuntimeConfigConnectorSdkProvider service={sdk}><DesktopMotionProvider><TooltipProvider>
        <Arrange key={String(cached)} cached={cached} />
      </TooltipProvider></DesktopMotionProvider></RuntimeConfigConnectorSdkProvider>
    </DesktopRendererBindingProvider></AppStoreProvider></I18nextProvider>,
  ));
  const body = dom.window.document.body;
  try {
    await render(false);
    assert.match(body.textContent!, /Loading connections/);
    await act(async () => reads[0]!.reject(new Error('Runtime list failed')));
    assert.match(body.textContent!, /Couldn’t load connections/);
    assert.doesNotMatch(body.textContent!, /Showing the last available list/);
    assert.equal(body.querySelector('[data-testid="cloud-empty-state"]'), null);
    const retry = body.querySelector<HTMLButtonElement>('[data-testid="cloud-connector-list-unavailable"] button');
    assert.ok(retry);
    await act(async () => retry.click());
    await act(async () => reads[1]!.resolve([]));
    assert.equal(body.querySelector('[data-testid="cloud-connector-list-unavailable"]'), null);
    assert.ok(body.querySelector('[data-testid="cloud-empty-state"]'));

    await render(true);
    await act(async () => reads[2]!.reject(new Error('Inventory temporarily unavailable')));
    assert.match(body.textContent!, /Showing the last available list/);
    assert.match(body.textContent!, /Previously read connector/);
  } finally {
    await act(async () => root.unmount());
    store.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
