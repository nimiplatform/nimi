import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';

test('Home filters access sources, exposes approval scope and ends only the selected connection', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, React, IS_REACT_ACT_ENVIRONMENT: true };
  const before = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { HomeRemoteAccess } = await import('../src/shell/renderer/features/settings/home-remote-access.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { RemoteAccessConnectionState, RemoteSourceAccessState } = await import('@nimiplatform/sdk/runtime/wire-types');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().setAuthSession({ id: 'account', realmEnvironmentId: 'realm' });
  await store.navigation.push({ id: 'connections', connectionAppId: 'example.app' });
  let state: GetRemoteAccessStateResponse = { enabled: true, bindingId: 'binding', connectionState: RemoteAccessConnectionState.LISTENING, reasonCode: '',
    sources: [{ clientId: 'source', appId: 'example.app', displayName: 'Example App', origin: 'https://example.app', sourceRevision: '1', state: RemoteSourceAccessState.ALLOWED,
      officialManager: false, appAccess: [], capabilityContractRefs: [], pendingRequestId: '' },
      { clientId: 'pending', appId: 'example.app', displayName: 'Pending App', origin: 'https://pending.example', sourceRevision: '2', state: RemoteSourceAccessState.CHANGED,
        officialManager: false, appAccess: ['runtime.consume'], capabilityContractRefs: [], pendingRequestId: 'request' },
      { clientId: 'paused', appId: 'example.app', displayName: 'Paused App', origin: 'https://paused.example', sourceRevision: '1', state: RemoteSourceAccessState.PAUSED,
        officialManager: false, appAccess: [], capabilityContractRefs: [], pendingRequestId: '' }],
    connectedPeers: 2, connections: [
      { connectionId: 'first', clientId: 'source', connectedAt: { seconds: '1700000000', nanos: 0 } },
      { connectionId: 'second', clientId: 'source', connectedAt: { seconds: '1700000001', nanos: 0 } },
    ] };
  const ended: unknown[] = [];
  let failRead = false;
  const remoteAccess = {
    async getRemoteAccessState() { if (failRead) throw new Error('Read failed'); return state; },
    async disconnectRemoteConnection(request: { connectionId: string; expectedBindingId: string }) {
      ended.push(request);
      state = { ...state, connectedPeers: 1, connections: state.connections.filter(row => row.connectionId !== request.connectionId) };
      return { state };
    },
    async setRemoteSourcePaused() { assert.fail('ending one connection must not pause its source'); },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root')!);
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 40 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.ok(predicate());
  };
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}>
      <DesktopMotionProvider><DesktopRendererBindingProvider bindings={{ sdk: { accountProduct: () => ({ remoteAccess }) } } as never}>
        <HomeRemoteAccess account="account" realm="realm" primaryBindingId="binding" thisRuntime primaryStateKnown validAfter="" />
      </DesktopRendererBindingProvider></DesktopMotionProvider>
    </AppStoreProvider></QueryClientProvider>));
    await settle(() => document.querySelectorAll('[data-testid="remote-connection"]').length === 2);
    const clickFilter = async (name: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[aria-pressed]')].find(element => element.textContent?.startsWith(name));
      assert.ok(button);
      await act(async () => button.click());
    };
    await clickFilter('Pending');
    assert.equal(document.querySelectorAll('article').length, 1);
    assert.ok(document.querySelector('[data-testid="remote-source:pending"]')?.textContent?.includes('Cloud calls use this PC'));
    assert.ok(document.body.textContent?.includes('AI use and this application'));
    assert.ok(document.body.textContent?.includes('Allow this source'));
    await clickFilter('Paused');
    assert.equal(document.querySelectorAll('article').length, 1);
    await act(async () => (document.querySelector('article button[aria-expanded]') as HTMLButtonElement).click());
    assert.ok(document.querySelector('article')?.textContent?.includes('Resume access'));
    await clickFilter('Connected');
    assert.equal(document.querySelectorAll('article').length, 1);
    await act(async () => (document.querySelector('article button[aria-expanded]') as HTMLButtonElement).click());
    assert.ok(document.querySelector('article')?.textContent?.includes('Pausing closes all connections'));
    await act(async () => (document.querySelector('[data-connection-id="second"] button') as HTMLButtonElement).click());
    await settle(() => document.querySelectorAll('[data-testid="remote-connection"]').length === 1);
    assert.deepEqual(ended, [{ connectionId: 'second', expectedBindingId: 'binding' }]);
    assert.ok(document.querySelector('[data-connection-id="first"]'));
    assert.equal(state.sources[0]?.state, RemoteSourceAccessState.ALLOWED);
    failRead = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['home-remote-access'] }); });
    await settle(() => Boolean((document.querySelector('[data-connection-id="first"] button') as HTMLButtonElement)?.disabled));
    assert.ok(document.body.textContent?.includes('Could not read or change remote access'));
    const pause = [...document.querySelectorAll<HTMLButtonElement>('article button')].find(button => button.textContent === 'Pause access');
    assert.equal(pause?.disabled, true);
    const disable = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Disable remote access');
    assert.equal(disable?.disabled, true);
    assert.ok(document.body.textContent?.includes('Showing previously read records'));
    assert.equal(document.body.textContent?.includes('No sources have requested access yet.'), false);
    failRead = false;
    await act(async () => { await client.invalidateQueries({ queryKey: ['home-remote-access'] }); });
    await settle(() => !pause?.disabled);
    await act(async () => { await store.navigation.push({ id: 'connections', connectionSourceId: 'pending' }); });
    await settle(() => Boolean(document.querySelector('[data-testid="remote-source:pending"]')));
    assert.equal(document.querySelectorAll('article').length, 1);
  } finally {
    await act(async () => root.unmount()); client.clear(); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
