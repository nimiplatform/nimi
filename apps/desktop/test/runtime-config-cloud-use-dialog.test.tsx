import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { RuntimeSetupTaskStore } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';

async function withDialog(run: (fixture: {
  choose: () => Promise<void>;
  dismiss: () => Promise<void>;
  unmountDialog: () => Promise<void>;
  finishAccountRead: () => Promise<void>;
  closed: () => number;
  opened: string[];
  tasksBefore: string;
  taskStore: RuntimeSetupTaskStore;
}) => Promise<void>, existingTask = false) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  let resolveAccount!: (value: unknown) => void;
  const accountRead = new Promise<unknown>(resolve => { resolveAccount = resolve; });
  let reads = 0;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
    HTMLFormElement: dom.window.HTMLFormElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
    __NIMI_TAURI_TEST__: { invoke: async (command: string) => {
      assert.equal(command, 'runtime_account_session_status');
      reads++;
      return accountRead;
    } },
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { getRuntimeSetupTaskStore } = await import('../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { CloudConnectorUseDialog } = await import('../src/shell/renderer/features/runtime-config/runtime-config-cloud-use-dialog.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  appStore.getState().setAuthSession({ id: 'cloud-use-account' });
  await appStore.navigation.push({ id: 'cloud', runtime: { connectorId: 'connection-test' } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(['desktop', 'apps-overview'], { status: 'loaded', entries: [], runtimeError: null, catalogStatus: 'loaded' });
  queryClient.setQueryData(['desktop', 'apps-overview-catalog'], { status: 'loaded', targets: [] });
  const bindings = { sdk: { machineProduct: () => ({ apps: {} }) } } as unknown as DesktopCanonicalRendererBindings;
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
  const opened: string[] = [];
  let closed = 0;
  let hide!: () => void;
  const taskStore = getRuntimeSetupTaskStore();
  if (existingTask) taskStore.createTask({ capabilityContract: 'text.generate', source: {
    kind: 'app', ownerAppId: 'nimi.desktop', accountId: 'cloud-use-account', returnFocus: 'apps',
  } });
  const tasksBefore = JSON.stringify(taskStore.getSnapshot().tasks);
  function Harness() {
    const [visible, setVisible] = useState(true);
    hide = () => setVisible(false);
    return visible ? <CloudConnectorUseDialog connectorId="connection-test" entry={{
      provider: 'test', providerModelId: 'test-model', modelLabel: 'Test model',
      remoteModelCatalogId: 'test-catalog', capabilities: ['text.generate'], available: true,
    }} onClose={() => { closed++; setVisible(false); }} onOpenTask={taskId => opened.push(taskId)} /> : null;
  }
  try {
    await act(async () => root.render(<QueryClientProvider client={queryClient}><AppStoreProvider store={appStore}><DesktopRendererBindingProvider bindings={bindings}><I18nextProvider i18n={i18n}><DesktopMotionProvider><Harness /></DesktopMotionProvider></I18nextProvider></DesktopRendererBindingProvider></AppStoreProvider></QueryClientProvider>));
    await run({
      choose: async () => {
        const button = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'runtimeConfig.cloudWorkspace.nimiChat');
        assert.ok(button, dom.window.document.body.innerHTML);
        await act(async () => button.click());
        assert.equal(reads, 1, 'the entry is waiting for the real account-source reader');
      },
      dismiss: async () => {
        await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        assert.equal(closed, 1, 'Escape dismisses the dialog even while the account read is pending');
        assert.equal(dom.window.document.querySelector('[data-testid="cloud-use-dialog"]'), null);
      },
      unmountDialog: async () => { await act(async () => hide()); },
      finishAccountRead: async () => {
        await act(async () => resolveAccount({ sequence: '1', state: 'authenticated', authorizationRevision: 'revision-1', reasonCode: 1, accountReasonCode: 1,
          accountProjection: { accountId: 'cloud-use-account', displayName: 'Test account', realmEnvironmentId: 'realm-test' } }));
      },
      closed: () => closed, opened, tasksBefore, taskStore,
    });
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    await new Promise(resolve => setTimeout(resolve, 0));
    dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

test('dismissing cloud use while account resolution is pending creates no task or navigation', async () => {
  for (const existingTask of [false, true]) {
    await withDialog(async fixture => {
      await fixture.choose();
      await fixture.dismiss();
      await fixture.finishAccountRead();
      assert.deepEqual(fixture.opened, []);
      assert.equal(JSON.stringify(fixture.taskStore.getSnapshot().tasks), fixture.tasksBefore, 'no task is created or rewritten');
      assert.equal(fixture.closed(), 1, 'the late result does not close a replacement surface');
    }, existingTask);
  }
});

test('unmounting cloud use abandons its pending entry, while a current entry still opens normally', async () => {
  await withDialog(async fixture => {
    await fixture.choose();
    await fixture.unmountDialog();
    await fixture.finishAccountRead();
    assert.deepEqual(fixture.opened, []);
    assert.equal(JSON.stringify(fixture.taskStore.getSnapshot().tasks), fixture.tasksBefore);
  });
  await withDialog(async fixture => {
    await fixture.choose();
    await fixture.finishAccountRead();
    assert.equal(fixture.opened.length, 1);
    assert.equal(fixture.closed(), 1);
    const task = fixture.taskStore.getTask(fixture.opened[0]!);
    assert.equal(task?.source.ownerAppId, 'nimi.desktop');
    assert.equal(task?.draft?.cloudConnectorRef, 'connection-test');
  });
});
