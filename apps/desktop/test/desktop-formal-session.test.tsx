import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { StreamControllerProvider } from '../src/shell/renderer/features/turns/stream-controller-context.js';
import type { StreamController } from '../src/shell/renderer/features/turns/stream-controller.js';
import { SupportRepairSection } from '../src/shell/renderer/features/support/support-repair-section.js';
import { initI18n } from '../src/shell/renderer/i18n/index.js';
import {
  DesktopFormalSessionRecoveryContext,
  useDesktopFormalSessionReadiness,
  type DesktopFormalSessionReadiness,
} from '../src/shell/renderer/app-shell/routes/desktop-formal-session.js';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ready = { sessionBound: true, reasonCode: 'action-executed' };
test.before(async () => { await initI18n(); });

async function setup() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.getState().setAuthSession({ id: 'account-a' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const probes: ReturnType<typeof deferred<typeof ready>>[] = [];
  const business: string[] = [];
  let stops = 0, cleanups = 0;
  let handle!: DesktopFormalSessionReadiness;
  const bindings = {
    sdk: { appProduct: () => ({ auth: { status: () => {
      const probe = deferred<typeof ready>(); probes.push(probe); return probe.promise;
    } } }) },
    app: { commands: { supportRepair: {
      loadProductControlRecord: async () => ({ state: 'ready_for_use', record: { repair: { required: false } } }),
      loadStorageDirs: async () => null,
    } } },
  } as unknown as DesktopCanonicalRendererBindings;
  const streams = { clearAllStreams: () => { stops++; } } as unknown as StreamController;
  function Business() {
    const account = store.getState().auth.user?.id as string;
    useEffect(() => { business.push(account); return () => { cleanups++; }; }, [account]);
    return <><span data-testid="current-account">{account}</span><SupportRepairSection onNavigateToRecovery={() => {}} /></>;
  }
  function Consumer() {
    handle = useDesktopFormalSessionReadiness();
    return <DesktopFormalSessionRecoveryContext.Provider value={handle.retry}>
      {handle.status === 'ready' ? <Business /> : <span>{handle.status}</span>}
    </DesktopFormalSessionRecoveryContext.Provider>;
  }
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}><AppStoreProvider store={store}>
      <DesktopRendererBindingProvider bindings={bindings}><StreamControllerProvider controller={streams}>
        <Consumer />
      </StreamControllerProvider></DesktopRendererBindingProvider>
    </AppStoreProvider></QueryClientProvider>,
  ));
  return {
    dom, store, queryClient, probes, business, handle: () => handle,
    stops: () => stops, cleanups: () => cleanups,
    async close() {
      await act(async () => root.unmount()); queryClient.clear(); dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

test('failed technical readiness stays closed and an explicit retry coalesces without replaying work', async () => {
  const fixture = await setup();
  try {
    assert.equal(fixture.probes.length, 1);
    await act(async () => fixture.probes[0]!.reject({ reasonCode: 'local-app-snapshot-unavailable' }));
    assert.equal(fixture.handle().status, 'failed');
    assert.equal(fixture.handle().reasonCode, 'local-app-snapshot-unavailable');
    assert.deepEqual(fixture.business, []);
    await act(async () => fixture.store.getState().setActiveTab('integrations'));
    await act(async () => { fixture.handle().retry(); fixture.handle().retry(); });
    assert.equal(fixture.probes.length, 2);
    assert.equal(fixture.store.getState().activeTab, 'home');
    assert.equal(fixture.handle().status, 'checking');
    await act(async () => fixture.probes[1]!.resolve(ready));
    assert.equal(fixture.handle().status, 'ready');
    assert.deepEqual(fixture.business, ['account-a']);

    // Exercise the actual Support product action. It unmounts current
    // business and drops its cache before issuing only a new probe.
    fixture.queryClient.setQueryData(['old-business'], { body: 'old' });
    const recover = fixture.dom.window.document.querySelector<HTMLButtonElement>('[data-testid="support-local-session-retry"]');
    assert.ok(recover, 'the product recovery action stays reachable in healthy Product Control');
    await act(async () => recover.click());
    assert.equal(fixture.cleanups(), 1);
    assert.equal(fixture.queryClient.getQueryData(['old-business']), undefined);
    assert.equal(fixture.probes.length, 3);
    assert.deepEqual(fixture.business, ['account-a']);
    await act(async () => fixture.probes[2]!.reject({ reasonCode: 'runtime-service-unavailable' }));
    assert.equal(fixture.handle().status, 'failed');
    await act(async () => fixture.handle().retry());
    await act(async () => fixture.probes[3]!.resolve(ready));
    assert.equal(fixture.handle().status, 'ready');
    assert.deepEqual(fixture.business, ['account-a', 'account-a']);
    assert.ok(fixture.stops() >= 4);
  } finally { await fixture.close(); }
});

test('account change hides old work immediately, cancels queries and ignores its late readiness', async () => {
  const fixture = await setup();
  try {
    const oldBody = deferred<string>();
    let oldSignal!: AbortSignal;
    const oldRead = fixture.queryClient.fetchQuery({ queryKey: ['account-a-body'], queryFn: ({ signal }) => {
      oldSignal = signal; return oldBody.promise;
    } }).catch(() => undefined);
    await act(async () => fixture.store.getState().setAuthSession({ id: 'account-b' }));
    assert.equal(fixture.handle().status, 'checking');
    assert.equal(oldSignal.aborted, true);
    assert.equal(fixture.probes.length, 2);
    await act(async () => { fixture.probes[0]!.resolve(ready); oldBody.resolve('account-a-secret'); await oldRead; });
    assert.equal(fixture.handle().status, 'checking');
    assert.deepEqual(fixture.business, []);
    assert.equal(fixture.queryClient.getQueryData(['account-a-body']), undefined);
    await act(async () => fixture.probes[1]!.resolve(ready));
    assert.deepEqual(fixture.business, ['account-b']);
    assert.equal(fixture.dom.window.document.querySelector('[data-testid="current-account"]')!.textContent, 'account-b');
    await act(async () => fixture.store.setState(state => ({ auth: { ...state.auth, status: 'refresh-pending' } })));
    assert.equal(fixture.handle().status, 'ready');
    await act(async () => fixture.store.setState(state => ({ auth: { ...state.auth, status: 'authenticated' } })));
    assert.equal(fixture.probes.length, 2, 'same-account credential refresh does not reopen business');
    assert.equal(fixture.cleanups(), 0);
  } finally { await fixture.close(); }
});

test('a successful call with an unbound projection does not admit Home', async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.probes[0]!.resolve({ sessionBound: false, reasonCode: 'account-changed' }));
    assert.equal(fixture.handle().status, 'failed');
    assert.deepEqual(fixture.business, []);
  } finally { await fixture.close(); }
});
