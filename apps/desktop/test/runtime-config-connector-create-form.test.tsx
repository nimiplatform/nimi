import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { I18nextProvider } from 'react-i18next';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { RuntimeConfigConnectorSdkService } from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.js';

async function withCreateDialog(run: (ui: {
  document: Document;
  requests: { resolve(): void; reject(error: Error): void }[];
  created: string[];
  closeCount(): number;
  startCreate(secret: string): Promise<void>;
  escape(): Promise<void>;
  account(id: string): Promise<void>;
  settle(): Promise<void>;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, getComputedStyle: dom.window.getComputedStyle,
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { createDesktopI18n } = await import('../src/shell/renderer/i18n/desktop-i18n.js');
  const { RuntimeConfigConnectorSdkProvider } = await import('../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-context.js');
  const { RuntimeConfigConnectorCreateDialog } = await import('../src/shell/renderer/features/runtime-config/runtime-config-connector-create-form.js');
  const { normalizeConnectorV11 } = await import('../src/shell/renderer/features/runtime-config/runtime-config-state-types.js');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.setState(state => ({ auth: { ...state.auth, status: 'authenticated', user: { id: 'account-a' } } }));
  const requests: { resolve(): void; reject(error: Error): void }[] = [];
  const service = {
    sdkListProviderCatalog: async () => [{ provider: 'openai', defaultEndpoint: 'https://api.openai.com/v1', requiresExplicitEndpoint: false, managedSupported: true }],
    sdkCreateConnector: () => new Promise((resolve, reject) => requests.push({
      resolve: () => resolve(normalizeConnectorV11({ id: 'created-connection', provider: 'openai', hasCredential: true })), reject,
    })),
  } as unknown as RuntimeConfigConnectorSdkService;
  const bindings = { app: { commands: { connectorAuth: {} } } } as DesktopCanonicalRendererBindings;
  const i18nResource = createDesktopI18n({ initialLocale: 'en', development: false, now: Date.now });
  await i18nResource.init();
  const i18n = i18nResource.instance;
  const created: string[] = [];
  let closed = 0;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  try {
    await act(async () => root.render(<AppStoreProvider store={store}><I18nextProvider i18n={i18n}><DesktopI18nResourceProvider resource={i18nResource}><DesktopMotionProvider><DesktopRendererBindingProvider bindings={bindings}><RuntimeConfigConnectorSdkProvider service={service}>
      <RuntimeConfigConnectorCreateDialog open onClose={() => { closed++; }} onCreated={id => created.push(id)} />
    </RuntimeConfigConnectorSdkProvider></DesktopRendererBindingProvider></DesktopMotionProvider></DesktopI18nResourceProvider></I18nextProvider></AppStoreProvider>));
    await settle();
    const provider = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="runtime-connector-create-provider:openai"]');
    assert.ok(provider);
    await act(async () => provider.click());
    await run({
      document: dom.window.document, requests, created, closeCount: () => closed, settle,
      account: id => act(async () => { store.setState(state => ({ auth: { ...state.auth, user: { id } } })); }),
      escape: () => act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }),
      startCreate: async secret => {
        const input = dom.window.document.querySelector<HTMLInputElement>('input[type="password"]');
        assert.ok(input);
        await act(async () => {
          Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, secret);
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        const submit = Array.from(dom.window.document.querySelectorAll('button')).find(button => button.textContent === i18n.t('runtimeConfig.cloud.createConnector'));
        assert.ok(submit);
        assert.equal(submit.disabled, false);
        await act(async () => submit.click());
      },
    });
  } finally {
    await act(async () => root.unmount());
    await new Promise(resolve => setTimeout(resolve, 0));
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

test('submitted API-key creation blocks dialog dismissal until the mutation resolves', async () => {
  await withCreateDialog(async ui => {
    await ui.startCreate('test-key');
    assert.equal(ui.requests.length, 1);
    assert.equal(ui.document.querySelector<HTMLInputElement>('input[type="password"]')!.disabled, true);
    const cancel = Array.from(ui.document.querySelectorAll('button')).find(button => button.textContent === 'Cancel');
    assert.ok(cancel);
    assert.equal(cancel.disabled, true);
    await ui.escape();
    assert.equal(ui.closeCount(), 0);
    await act(async () => ui.requests[0]!.resolve());
    assert.deepEqual(ui.created, ['created-connection']);
    await ui.escape();
    assert.equal(ui.closeCount(), 1);
  });
});

test('account changes clear the pending key and discard old-account creation results and errors', async () => {
  await withCreateDialog(async ui => {
    await ui.startCreate('account-a-key');
    await ui.account('account-b');
    assert.equal(ui.document.querySelector<HTMLInputElement>('input[type="password"]')!.value, '');
    await act(async () => ui.requests[0]!.resolve());
    assert.deepEqual(ui.created, []);
    await ui.startCreate('account-b-key');
    await ui.account('account-c');
    await act(async () => ui.requests[1]!.reject(new Error('old-account-private-error')));
    assert.doesNotMatch(ui.document.body.textContent!, /old-account-private-error/);
    assert.deepEqual(ui.created, []);
    assert.equal(ui.document.querySelector<HTMLInputElement>('input[type="password"]')!.value, '');
    await ui.escape();
    assert.equal(ui.closeCount(), 1);
  });
});
