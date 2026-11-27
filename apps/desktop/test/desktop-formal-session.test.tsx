import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createReadyConversationSetupState } from '@nimiplatform/kit/features/chat/headless';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { INITIAL_RUNTIME_FIELDS } from '../src/shell/renderer/app-shell/providers/store-types.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { SupportTroubleshooting } from '../src/shell/renderer/features/support/support-troubleshooting.js';
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
  const authenticate = (id: string, revision: string) => store.setState(({ auth }) => ({ auth: {
    ...auth, status: 'authenticated', authorizationRevision: revision, user: { id, realmEnvironmentId: 'realm-a' },
  } }));
  authenticate('account-a', 'same-account-authorization');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const probes: ReturnType<typeof deferred<typeof ready>>[] = [];
  const business: string[] = [];
  let cleanups = 0;
  let handle!: DesktopFormalSessionReadiness;
  let sessionInvalidated: (() => void) | undefined;
  const bindings = {
    sdk: { appProduct: () => ({ auth: { status: () => {
      const probe = deferred<typeof ready>(); probes.push(probe); return probe.promise;
    } } }) },
    app: { events: { subscribeFormalSessionInvalidation: (listener: () => void) => {
      sessionInvalidated = listener;
      return () => { sessionInvalidated = undefined; };
    } }, commands: { supportRepair: {
      loadProductControlRecord: async () => ({ state: 'ready_for_use', record: { repair: { required: false } } }),
      loadStorageDirs: async () => null,
    } } },
  } as unknown as DesktopCanonicalRendererBindings;
  function Business() {
    const account = store.getState().auth.user?.id as string;
    useEffect(() => { business.push(account); return () => { cleanups++; }; }, [account]);
    return <><span data-testid="current-account">{account}</span><SupportTroubleshooting /></>;
  }
  function Consumer() {
    handle = useDesktopFormalSessionReadiness();
    return <DesktopFormalSessionRecoveryContext.Provider value={handle.retry}>
      {handle.status === 'ready' ? <Business /> : <span>{handle.status}</span>}
    </DesktopFormalSessionRecoveryContext.Provider>;
  }
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}><AppStoreProvider store={store}>
      <DesktopRendererBindingProvider bindings={bindings}>
        <Consumer />
      </DesktopRendererBindingProvider>
    </AppStoreProvider></QueryClientProvider>,
  ));
  return {
    dom, store, queryClient, probes, business, authenticate, invalidate: () => sessionInvalidated?.(), handle: () => handle,
    cleanups: () => cleanups,
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
    await act(async () => { await fixture.store.navigation.push({ id: 'home', homeSection: 'integrations' }); });
    assert.deepEqual(fixture.store.navigation.getSnapshot().current.destination, { id: 'home', homeSection: 'integrations' });
    await act(async () => { fixture.handle().retry(); fixture.handle().retry(); });
    assert.equal(fixture.probes.length, 2);
    assert.deepEqual(fixture.store.navigation.getSnapshot().current.destination, { id: 'home', homeSection: 'overview' });
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
    await act(async () => fixture.authenticate('account-b', 'authorization-b'));
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

test('Account authorization continuity cannot turn an independently failed App session into ready', async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.probes[0]!.reject({ reasonCode: 'local-app-snapshot-unavailable' }));
    await act(async () => fixture.store.setState(state => ({ auth: {
      ...state.auth, authorizationRevision: 'same-account-authorization', status: 'refresh-pending',
    } })));
    await act(async () => fixture.store.setState(state => ({ auth: { ...state.auth, status: 'authenticated' } })));
    assert.equal(fixture.handle().status, 'failed');
    assert.equal(fixture.handle().reasonCode, 'local-app-snapshot-unavailable');
    assert.equal(fixture.probes.length, 1);
    assert.deepEqual(fixture.business, []);
  } finally { await fixture.close(); }
});


test('owner loss and an authorization replacement each retire the established gate', async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.probes[0]!.resolve(ready));
    fixture.queryClient.setQueryData(['old-business'], 'old');
    await act(async () => fixture.invalidate());
    assert.equal(fixture.handle().status, 'checking');
    assert.equal(fixture.cleanups(), 1);
    assert.equal(fixture.queryClient.getQueryData(['old-business']), undefined);
    await act(async () => fixture.probes[1]!.resolve({ sessionBound: false, reasonCode: 'session-invalid' }));
    assert.equal(fixture.handle().status, 'failed');
    await act(async () => fixture.authenticate('account-a', 'replacement-authorization'));
    assert.equal(fixture.handle().status, 'checking');
    await act(async () => fixture.probes[2]!.resolve(ready));
    assert.equal(fixture.handle().status, 'ready');
    assert.deepEqual(fixture.business, ['account-a', 'account-a']);
  } finally { await fixture.close(); }
});

test('A -> B Runtime projection handover clears queryClient and resets all un-scoped Zustand view state while keeping global state intact', async () => {
  const fixture = await setup();
  try {
    await act(async () => fixture.probes[0]!.resolve(ready));
    assert.equal(fixture.handle().status, 'ready');

    // Seed global fields (must stay intact across A -> B).
    const runtimeDefaults = {
      realm: { realmBaseUrl: 'https://realm.example.test', realtimeUrl: '', accessToken: '', jwksUrl: '', revocationUrl: '', jwtIssuer: '', jwtAudience: '' },
      runtime: {
        localProviderEndpoint: '',
        localProviderModel: '',
        localOpenAiEndpoint: '',
        connectorId: '',
        targetType: 'agent',
        targetAccountId: 'default-target',
        agentId: 'default-agent',
        worldId: 'default-world',
        provider: '',
        userConfirmedUpload: false,
      },
    };
    fixture.store.getState().setBootstrapReady(true);
    fixture.store.getState().setBootstrapError(null);
    fixture.store.getState().setRuntimeMaintenance(null);
    fixture.store.getState().setRuntimeDefaults(runtimeDefaults);
    fixture.store.getState().setOfflineTier('L1');
    fixture.store.getState().setPrimaryRailVisible(false);

    // Seed every account-bound / un-scoped view and selection field for Account A.
    fixture.store.getState().setChatSourceFilter('human');
    fixture.store.getState().setChatViewMode('human', 'peer-a', 'chat');
    fixture.store.getState().setChatViewMode('ai', 'agent-a', 'stage');
    fixture.store.getState().setLastSelectedThreadForMode('ai', 'ai-thread-a');
    fixture.store.getState().setLastSelectedThreadForMode('human', 'human-thread-a');
    fixture.store.getState().setChatSetupState('ai', createReadyConversationSetupState('ai'));
    fixture.store.getState().setChatSetupState('human', createReadyConversationSetupState('human'));
    fixture.store.getState().setRuntimeFields({
      targetType: 'human',
      targetAccountId: 'account-a-target',
      agentId: 'agent-a',
      targetId: 'target-a',
      worldId: 'world-a',
      mode: 'SCENE_TURN',
      turnIndex: 7,
      userConfirmedUpload: true,
    });
    fixture.store.getState().setHomePartnerDraft('account-a', 'partner-a', 'Secret draft for A');
    fixture.store.getState().setPendingNimiComposerPrefill('Secret prefill for A');
    fixture.store.getState().setProfileDetailOverlayOpen(true);
    fixture.queryClient.setQueryData(['account-a-cache'], { secret: 'from-a' });

    // Direct authenticated switch A -> B through applyRuntimeAccountProjection.
    await act(async () => {
      fixture.store.getState().applyRuntimeAccountProjection({
        status: 'authenticated',
        sequence: '20',
        reasonCode: 0,
        accountReasonCode: 0,
        authorizationRevision: 'authorization-b',
        user: { id: 'account-b', displayName: 'User B', realmEnvironmentId: 'realm-a' },
      });
    });

    assert.equal(fixture.handle().status, 'checking');
    assert.equal(fixture.queryClient.getQueryData(['account-a-cache']), undefined);

    const next = fixture.store.getState();
    assert.equal(next.auth.user?.id, 'account-b');
    assert.equal(next.chatSourceFilter, 'all');
    assert.deepEqual(next.viewModeBySourceTarget, {});
    assert.deepEqual(next.lastSelectedThreadByMode, { ai: null, human: null });
    assert.deepEqual(next.chatSetupState, { ai: null, human: null });
    assert.deepEqual(next.runtimeFields, INITIAL_RUNTIME_FIELDS);
    assert.deepEqual(next.homePartnerDrafts, {});
    assert.equal(next.pendingNimiComposerPrefill, null);
    assert.equal(next.profileDetailOverlayOpen, false);

    // Global fields stay intact.
    assert.equal(next.bootstrapReady, true);
    assert.equal(next.bootstrapError, null);
    assert.equal(next.runtimeMaintenance, null);
    assert.deepEqual(next.runtimeDefaults, runtimeDefaults);
    assert.equal(next.offlineTier, 'L1');
    assert.equal(next.primaryRailVisible, false);

    await act(async () => fixture.probes[1]!.resolve(ready));
    assert.equal(fixture.handle().status, 'ready');
    assert.deepEqual(fixture.business, ['account-a', 'account-b']);
  } finally { await fixture.close(); }
});

test('transition to anonymous, switching, and reauth-required resets all un-scoped Zustand view state', () => {
  for (const terminalStatus of ['anonymous', 'switching', 'reauth-required'] as const) {
    const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
    store.getState().applyRuntimeAccountProjection({
      status: 'authenticated',
      sequence: '1',
      reasonCode: 0,
      accountReasonCode: 0,
      authorizationRevision: 'rev-a',
      user: { id: 'account-a', realmEnvironmentId: 'realm-a' },
    });
    store.getState().setBootstrapReady(true);
    store.getState().setOfflineTier('L1');
    store.getState().setPrimaryRailVisible(false);
    store.getState().setChatSourceFilter('human');
    store.getState().setChatViewMode('human', 'peer-a', 'chat');
    store.getState().setLastSelectedThreadForMode('ai', 'ai-thread-a');
    store.getState().setLastSelectedThreadForMode('human', 'human-thread-a');
    store.getState().setChatSetupState('ai', createReadyConversationSetupState('ai'));
    store.getState().setChatSetupState('human', createReadyConversationSetupState('human'));
    store.getState().setRuntimeField('targetAccountId', 'account-a-target');
    store.getState().setHomePartnerDraft('account-a', 'partner-a', 'Secret draft');
    store.getState().setPendingNimiComposerPrefill('Secret prefill');
    store.getState().setProfileDetailOverlayOpen(true);

    store.getState().applyRuntimeAccountProjection({
      status: terminalStatus,
      sequence: '2',
      reasonCode: 0,
      accountReasonCode: 0,
      authorizationRevision: '',
      user: terminalStatus === 'switching' ? { id: 'account-a', realmEnvironmentId: 'realm-a' } : null,
    });

    const state = store.getState();
    assert.equal(state.chatSourceFilter, 'all', terminalStatus);
    assert.deepEqual(state.viewModeBySourceTarget, {}, terminalStatus);
    assert.deepEqual(state.lastSelectedThreadByMode, { ai: null, human: null }, terminalStatus);
    assert.deepEqual(state.chatSetupState, { ai: null, human: null }, terminalStatus);
    assert.deepEqual(state.runtimeFields, INITIAL_RUNTIME_FIELDS, terminalStatus);
    assert.deepEqual(state.homePartnerDrafts, {}, terminalStatus);
    assert.equal(state.pendingNimiComposerPrefill, null, terminalStatus);
    assert.equal(state.profileDetailOverlayOpen, false, terminalStatus);
    assert.equal(state.bootstrapReady, true, terminalStatus);
    assert.equal(state.offlineTier, 'L1', terminalStatus);
    assert.equal(state.primaryRailVisible, false, terminalStatus);
    store.navigation.dispose();
  }
});
