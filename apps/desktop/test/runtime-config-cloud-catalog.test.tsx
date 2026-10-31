import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { NimiRuntimeConnectorCatalogEntry } from '@nimiplatform/sdk/runtime';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { RuntimeConfigConnectorSdkProvider } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-context.js';
import type { RuntimeConfigConnectorSdkService } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.js';
import { CloudConnectorCatalog } from '../src/shell/renderer/features/runtime-config/runtime-config-cloud-catalog.js';
import { normalizeConnectorV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion-context.js';

test('catalog browsing searches translated capabilities, pages results, and rejects stale or failed reads independently of connection checks', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
    Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.setState(state => ({ auth: { ...state.auth, status: 'authenticated', user: { id: 'account-a' } } }));
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: { runtimeConfig: { capabilityLabels: { textGenerate: '文本生成', imageGenerate: '图像生成' } } } } } });
  const reads: { id: string; resolve: (rows: readonly NimiRuntimeConnectorCatalogEntry[]) => void; reject: (error: Error) => void }[] = [];
  let checks = 0;
  const configured: string[] = [];
  const service = {
    sdkListConnectorCatalog: (id: string) => new Promise<readonly NimiRuntimeConnectorCatalogEntry[]>((resolve, reject) => reads.push({ id, resolve, reject })),
    sdkTestConnector: () => { checks++; throw Error('not a catalog operation'); },
  } as unknown as RuntimeConfigConnectorSdkService;
  const render = (id: string) => act(async () => root.render(<AppStoreProvider store={store}><I18nextProvider i18n={i18n}><DesktopMotionProvider><RuntimeConfigConnectorSdkProvider service={service}>
    <CloudConnectorCatalog connector={normalizeConnectorV11({ id, hasCredential: true, status: 'healthy', managementStatus: 'active', lastCheckedAt: '2026-10-26T00:00:00Z' })} onConfigure={entry => configured.push(entry.remoteModelCatalogId)} />
  </RuntimeConfigConnectorSdkProvider></DesktopMotionProvider></I18nextProvider></AppStoreProvider>));
  const row = (id: string): NimiRuntimeConnectorCatalogEntry => ({ modelLabel: id, providerModelId: id, remoteModelCatalogId: id, provider: 'test', capabilities: ['text.generate'], available: true });
  try {
    await render('first');
    assert.equal(reads[0]!.id, 'first', 'historical success does not suppress catalog loading');
    await render('second');
    await act(async () => reads[0]!.resolve([row('late-first')]));
    assert.doesNotMatch(dom.window.document.body.textContent!, /late-first/);
    const rows = [row('second-model'), ...Array.from({ length: 44 }, (_, index) => ({ ...row(`model-${index}`), capabilities: [index < 20 ? 'text.generate' : 'image.generate'], available: index !== 0 }))];
    await act(async () => reads[1]!.resolve(rows));
    assert.match(dom.window.document.body.textContent!, /second-model/);
    const modelRows = () => [...dom.window.document.querySelectorAll('[data-testid^="cloud-model:"]')];
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
    assert.equal(modelRows().length, 20, 'large catalogs start with a bounded, browsable result set');
    await act(async () => button('runtimeConfig.cloudWorkspace.loadMore').click());
    assert.equal(modelRows().length, 40);
    await act(async () => button('runtimeConfig.cloudWorkspace.loadMore').click());
    assert.equal(modelRows().length, 45, 'all models remain reachable without duplicates');
    const capability = dom.window.document.querySelector('select')!;
    await act(async () => { capability.value = 'image.generate'; capability.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.equal(modelRows().length, 20);
    assert.ok(modelRows().every(item => item.textContent?.includes('图像生成')));
    await act(async () => button('runtimeConfig.cloudWorkspace.clearFilters').click());
    const input = dom.window.document.querySelector('input')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await type('文本生成');
    assert.equal(modelRows().length, 20, 'search accepts the capability label the user sees');
    assert.ok(modelRows().every(item => item.textContent?.includes('文本生成')));
    await type('not-a-model');
    assert.equal(modelRows().length, 0);
    assert.match(dom.window.document.body.textContent!, /noSearchMatches/);
    await act(async () => button('runtimeConfig.cloudWorkspace.clearFilters').click());
    const unavailable = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="cloud-model:model-0"] button')!;
    assert.equal(unavailable.disabled, true, 'unavailable models remain visible but cannot be configured');
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid="cloud-model:second-model"] button')!.click());
    assert.deepEqual(configured, ['second-model'], 'the selected exact catalog entry reaches the consumer picker');
    await act(async () => store.setState(state => ({ auth: { ...state.auth, user: { id: 'account-b' } } })));
    assert.doesNotMatch(dom.window.document.body.textContent!, /second-model/, 'old account content clears synchronously');
    await act(async () => reads[2]!.reject(new Error('private response secret=must-not-render')));
    assert.ok(dom.window.document.querySelector('[role="alert"]'));
    assert.doesNotMatch(dom.window.document.body.textContent!, /must-not-render/);
    assert.equal(checks, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
