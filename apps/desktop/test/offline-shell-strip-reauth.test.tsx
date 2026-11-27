import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountReasonCode, RuntimeReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import { createReadyConversationSetupState } from '@nimiplatform/kit/features/chat/headless';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';
import type { DesktopBrowserAuthRuntimeBroker } from '@nimiplatform/kit/auth/shell';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { INITIAL_RUNTIME_FIELDS } from '../src/shell/renderer/app-shell/providers/store-types.js';
import { OfflineShellStrip } from '../src/shell/renderer/app-shell/layouts/offline-shell-strip.js';
import {
  DesktopFormalSessionRecoveryContext,
  useDesktopFormalSessionReadiness,
} from '../src/shell/renderer/app-shell/routes/desktop-formal-session.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n/index.js';
import { E2E_IDS } from '../src/shell/renderer/testability/e2e-ids.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type OAuthCallbackResult = Awaited<ReturnType<ShellOAuthCodeBridge['oauthListenForCode']>>;

const AUTHORIZE_URL = 'https://realm.example.test/api/auth/oauth/authorize?client_id=desktop&state=state-1';
const READY_SESSION = { sessionBound: true, reasonCode: 'action-executed' };

test.before(async () => {
  await initI18n();
});

async function setupStripHarness(options: {
  readonly withFormalGate?: boolean;
  readonly begin?: DesktopBrowserAuthRuntimeBroker['begin'];
  readonly complete?: DesktopBrowserAuthRuntimeBroker['complete'];
  readonly listen?: ShellOAuthCodeBridge['oauthListenForCode'];
  readonly openExternalUrl?: ShellOAuthCodeBridge['openExternalUrl'];
} = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  const openedUrls: string[] = [];
  const listenSignals: (AbortSignal | undefined)[] = [];
  let focusCalls = 0;
  let beginCalls = 0;
  let completeCalls = 0;
  const formalProbes: ReturnType<typeof deferred<typeof READY_SESSION>>[] = [];
  const mountedAccounts: string[] = [];

  const oauthBridge: ShellOAuthCodeBridge = {
    hasShellHostInvoke: () => true,
    oauthListenForCode: async (payload, signal) => {
      listenSignals.push(signal);
      if (options.listen) {
        return options.listen(payload, signal);
      }
      return { code: 'oauth-code-1', state: payload.expectedState };
    },
    openExternalUrl: async (url) => {
      openedUrls.push(url);
      if (options.openExternalUrl) {
        return options.openExternalUrl(url);
      }
      return { opened: true };
    },
    focusMainWindow: async () => {
      focusCalls += 1;
    },
  };

  const runtimeAccountBroker: DesktopBrowserAuthRuntimeBroker = {
    begin: async (input) => {
      beginCalls += 1;
      if (options.begin) {
        return options.begin(input);
      }
      return {
        loginAttemptId: `attempt-${beginCalls}`,
        authorizationUrl: AUTHORIZE_URL,
        state: 'state-1',
        nonce: 'nonce-1',
      };
    },
    complete: async (input) => {
      completeCalls += 1;
      if (options.complete) {
        return options.complete(input);
      }
      return { user: { id: 'account-a', displayName: 'User A', realmEnvironmentId: 'realm-a' } };
    },
  };

  const bindings = {
    sdk: {
      appProduct: () => ({
        auth: {
          status: () => {
            const probe = deferred<typeof READY_SESSION>();
            formalProbes.push(probe);
            return probe.promise;
          },
        },
      }),
    },
    app: {
      commands: {
        auth: {
          oauthBridge,
          runtimeAccountBroker,
        },
      },
      events: {
        subscribeFormalSessionInvalidation: () => () => undefined,
      },
    },
  } as unknown as DesktopCanonicalRendererBindings;

  // Start authenticated locally as Account A with REFRESH_OUTCOME_AMBIGUOUS (online credentials cleared).
  store.getState().applyRuntimeAccountProjection({
    status: 'authenticated',
    sequence: '10',
    reasonCode: RuntimeReasonCode.AUTH_TOKEN_INVALID,
    accountReasonCode: AccountReasonCode.REFRESH_OUTCOME_AMBIGUOUS,
    authorizationRevision: 'authorization-a',
    user: { id: 'account-a', displayName: 'User A', realmEnvironmentId: 'realm-a' },
  });
  store.getState().setOfflineTier('L1');

  function FormalGateHarness(props: React.PropsWithChildren) {
    const readiness = useDesktopFormalSessionReadiness();
    return (
      <DesktopFormalSessionRecoveryContext.Provider value={readiness.retry}>
        {readiness.status === 'ready' ? props.children : <span data-testid="formal-gate-status">{readiness.status}</span>}
      </DesktopFormalSessionRecoveryContext.Provider>
    );
  }

  function ProtectedShellChild() {
    const accountId = store.getState().auth.user?.id as string;
    useEffect(() => {
      mountedAccounts.push(accountId);
    }, [accountId]);
    return (
      <div data-testid="protected-shell-child">
        <OfflineShellStrip />
        <span data-testid="shell-account">{accountId}</span>
      </div>
    );
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AppStoreProvider store={store}>
          <DesktopRendererBindingProvider bindings={bindings}>
            {options.withFormalGate ? (
              <FormalGateHarness>
                <ProtectedShellChild />
              </FormalGateHarness>
            ) : (
              <OfflineShellStrip />
            )}
          </DesktopRendererBindingProvider>
        </AppStoreProvider>
      </QueryClientProvider>,
    );
  });

  const settle = async () => {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  return {
    dom,
    store,
    queryClient,
    openedUrls,
    listenSignals,
    formalProbes,
    mountedAccounts,
    settle,
    get beginCalls() { return beginCalls; },
    get completeCalls() { return completeCalls; },
    get focusCalls() { return focusCalls; },
    query: <T extends Element>(selector: string) => dom.window.document.querySelector<T>(selector),
    async unmount() {
      await act(async () => root.unmount());
    },
    async close() {
      await act(async () => root.unmount());
      queryClient.clear();
      store.navigation.dispose();
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

test('authenticated user with REFRESH_OUTCOME_AMBIGUOUS sees distinct online re-auth strip and button without logging out (L0/L1, EN/ZH)', async () => {
  const fixture = await setupStripHarness();
  try {
    for (const locale of ['en', 'zh'] as const) {
      await act(async () => { await changeLocale(locale); });
      const strip = fixture.query(`[data-testid="${E2E_IDS.offlineStrip}"]`);
      const button = fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]');
      assert.ok(strip, `strip must render in ${locale}`);
      assert.ok(button, `re-auth button must render in ${locale}`);
      assert.equal(fixture.store.getState().auth.status, 'authenticated');
      if (locale === 'en') {
        assert.match(strip.textContent ?? '', /Local sign-in active/);
        assert.doesNotMatch(strip.textContent ?? '', /Cloud offline \/ Offline mode/);
        assert.match(button.textContent ?? '', /Sign in to restore online/);
      } else {
        assert.match(strip.textContent ?? '', /本机已保持登录/);
        assert.doesNotMatch(strip.textContent ?? '', /云端离线 \/ 离线模式/);
        assert.match(button.textContent ?? '', /重新登录恢复在线/);
      }
    }

    // Even when offlineTier is L0, REFRESH_OUTCOME_AMBIGUOUS still shows the strip so user can restore online.
    await act(async () => { fixture.store.getState().setOfflineTier('L0'); });
    assert.ok(fixture.query(`[data-testid="${E2E_IDS.offlineStrip}"]`));
    assert.ok(fixture.query('[data-testid="offline-strip-reauth-button"]'));

    // L2 (runtime unavailable) hides the re-auth button and shows read-only runtime copy.
    await act(async () => { fixture.store.getState().setOfflineTier('L2'); });
    assert.ok(fixture.query(`[data-testid="${E2E_IDS.offlineStrip}"]`));
    assert.equal(fixture.query('[data-testid="offline-strip-reauth-button"]'), null);

    // Generic L1 cloud offline (without REFRESH_OUTCOME_AMBIGUOUS) shows cloud offline copy without re-auth button.
    await act(async () => {
      fixture.store.getState().applyRuntimeAccountProjection({
        status: 'authenticated',
        sequence: '11',
        reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
        accountReasonCode: AccountReasonCode.REFRESH_RETRY_DEFERRED,
        authorizationRevision: 'authorization-a',
        user: { id: 'account-a', displayName: 'User A', realmEnvironmentId: 'realm-a' },
      });
      fixture.store.getState().setOfflineTier('L1');
    });
    const genericStrip = fixture.query(`[data-testid="${E2E_IDS.offlineStrip}"]`);
    assert.ok(genericStrip);
    assert.equal(fixture.query('[data-testid="offline-strip-reauth-button"]'), null);
    await act(async () => { await changeLocale('en'); });
    assert.match(genericStrip.textContent ?? '', /Cloud offline \/ Offline mode/);
  } finally {
    await fixture.close();
    await changeLocale('en');
  }
});

test('cancel / end-wait aborts the OAuth listener, keeps local Account A work intact, and supports reopening & retrying', async () => {
  const firstCallback = deferred<OAuthCallbackResult>();
  let listenCount = 0;
  const fixture = await setupStripHarness({
    listen: (_payload, signal) => {
      listenCount += 1;
      if (listenCount === 1) {
        return new Promise<OAuthCallbackResult>((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          void firstCallback.promise.then(resolve, reject);
        });
      }
      return Promise.resolve({ code: 'retry-code', state: 'state-1' });
    },
  });
  try {
    fixture.store.getState().setHomePartnerDraft('account-a', 'partner-a', 'Keep local draft');
    fixture.store.getState().setChatSourceFilter('human');

    const startButton = fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')!;
    await act(async () => { startButton.click(); });
    await fixture.settle();

    assert.equal(fixture.beginCalls, 1);
    assert.equal(fixture.openedUrls.length, 1);
    assert.equal(fixture.openedUrls[0], AUTHORIZE_URL);
    assert.equal(fixture.listenSignals[0]?.aborted, false);
    assert.equal(startButton.disabled, true);
    assert.ok(fixture.query('[data-testid="offline-strip-reauth-status"]'));

    // Reopen browser opens the same runtime-issued URL again.
    const reopenButton = fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-reopen"]');
    assert.ok(reopenButton);
    await act(async () => { reopenButton.click(); });
    assert.equal(fixture.openedUrls.length, 2);
    assert.equal(fixture.openedUrls[1], AUTHORIZE_URL);

    // Cancel / Stop waiting aborts the listener and preserves local session + local state.
    const cancelButton = fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-cancel"]');
    assert.ok(cancelButton);
    await act(async () => { cancelButton.click(); });
    await fixture.settle();

    assert.equal(fixture.listenSignals[0]?.aborted, true);
    assert.equal(fixture.completeCalls, 0);
    assert.equal(fixture.store.getState().auth.status, 'authenticated');
    assert.equal(fixture.store.getState().auth.user?.id, 'account-a');
    assert.equal(fixture.store.getState().chatSourceFilter, 'human');
    assert.equal(Object.values(fixture.store.getState().homePartnerDrafts)[0], 'Keep local draft');
    assert.match(fixture.query('[data-testid="offline-strip-reauth-status"]')?.textContent ?? '', /Stopped waiting/);
    assert.equal(fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')?.disabled, false);
  } finally {
    await fixture.close();
  }
});

test('browser timeout and Realm exchange failure keep local user A authenticated with inline retry feedback', async () => {
  let attempt = 0;
  const fixture = await setupStripHarness({
    listen: async (payload) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('等待 OAuth 回调超时');
      }
      return { code: 'code-2', state: payload.expectedState };
    },
    complete: async () => {
      throw new Error('Runtime account login could not complete: REALM_UNREACHABLE');
    },
  });
  try {
    fixture.store.getState().setHomePartnerDraft('account-a', 'partner-a', 'Unsent local work');
    fixture.store.getState().setLastSelectedThreadForMode('ai', 'ai-thread-1');

    // Attempt 1: browser timeout.
    await act(async () => {
      fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')!.click();
    });
    await fixture.settle();

    assert.equal(fixture.store.getState().auth.status, 'authenticated');
    assert.equal(fixture.store.getState().auth.user?.id, 'account-a');
    assert.equal(fixture.store.getState().lastSelectedThreadByMode.ai, 'ai-thread-1');
    assert.equal(Object.values(fixture.store.getState().homePartnerDrafts)[0], 'Unsent local work');
    assert.match(fixture.query('[data-testid="offline-strip-reauth-error"]')?.textContent ?? '', /timed out/i);

    // Attempt 2: Realm exchange failure (broker.complete rejects).
    await act(async () => {
      fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')!.click();
    });
    await fixture.settle();

    assert.equal(fixture.completeCalls, 1);
    assert.equal(fixture.store.getState().auth.status, 'authenticated');
    assert.equal(fixture.store.getState().auth.user?.id, 'account-a');
    assert.equal(fixture.store.getState().lastSelectedThreadByMode.ai, 'ai-thread-1');
    assert.equal(Object.values(fixture.store.getState().homePartnerDrafts)[0], 'Unsent local work');
    assert.match(fixture.query('[data-testid="offline-strip-reauth-error"]')?.textContent ?? '', /Couldn't restore online sign-in/);
  } finally {
    await fixture.close();
  }
});

test('unmount and leaving online-reauth-required both abort in-flight AbortController', async () => {
  const pending1 = deferred<OAuthCallbackResult>();
  const fixture1 = await setupStripHarness({
    listen: () => pending1.promise,
  });
  try {
    await act(async () => {
      fixture1.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')!.click();
    });
    await fixture1.settle();
    assert.equal(fixture1.listenSignals[0]?.aborted, false);

    // Leaving REFRESH_OUTCOME_AMBIGUOUS aborts in-flight wait cleanly.
    await act(async () => {
      fixture1.store.getState().applyRuntimeAccountProjection({
        status: 'authenticated',
        sequence: '12',
        reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
        accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
        authorizationRevision: 'authorization-a',
        user: { id: 'account-a', displayName: 'User A', realmEnvironmentId: 'realm-a' },
      });
      fixture1.store.getState().setOfflineTier('L0');
    });
    assert.equal(fixture1.listenSignals[0]?.aborted, true);
    assert.equal(fixture1.query(`[data-testid="${E2E_IDS.offlineStrip}"]`), null);
  } finally {
    await fixture1.close();
  }

  const pending2 = deferred<OAuthCallbackResult>();
  const fixture2 = await setupStripHarness({
    listen: () => pending2.promise,
  });
  try {
    await act(async () => {
      fixture2.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')!.click();
    });
    await fixture2.settle();
    assert.equal(fixture2.listenSignals[0]?.aborted, false);

    await fixture2.unmount();
    assert.equal(fixture2.listenSignals[0]?.aborted, true);
  } finally {
    await fixture2.close();
  }
});

test('same-account browser re-auth restores online state and removes strip without disrupting local work', async () => {
  let completeAction!: () => void;
  const fixture = await setupStripHarness({
    complete: async () => {
      completeAction();
      return { user: { id: 'account-a', displayName: 'User A', realmEnvironmentId: 'realm-a' } };
    },
  });
  try {
    fixture.store.getState().setChatSourceFilter('human');
    fixture.store.getState().setLastSelectedThreadForMode('ai', 'ai-thread-a');
    fixture.store.getState().setHomePartnerDraft('account-a', 'partner-a', 'Local draft stays intact');

    completeAction = () => {
      fixture.store.getState().applyRuntimeAccountProjection({
        status: 'authenticated',
        sequence: '15',
        reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
        accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
        authorizationRevision: 'authorization-a',
        user: { id: 'account-a', displayName: 'User A', realmEnvironmentId: 'realm-a' },
      });
      fixture.store.getState().setOfflineTier('L0');
    };

    await act(async () => {
      fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')!.click();
    });
    await fixture.settle();

    assert.equal(fixture.beginCalls, 1);
    assert.equal(fixture.completeCalls, 1);
    assert.equal(fixture.store.getState().auth.status, 'authenticated');
    assert.equal(fixture.store.getState().auth.user?.id, 'account-a');
    assert.equal(fixture.store.getState().auth.accountReasonCode, AccountReasonCode.ACTION_EXECUTED);
    assert.equal(fixture.store.getState().offlineTier, 'L0');
    assert.equal(fixture.query(`[data-testid="${E2E_IDS.offlineStrip}"]`), null);

    // Local work & view state stayed untouched for the same account.
    assert.equal(fixture.store.getState().chatSourceFilter, 'human');
    assert.equal(fixture.store.getState().lastSelectedThreadByMode.ai, 'ai-thread-a');
    assert.equal(Object.values(fixture.store.getState().homePartnerDrafts)[0], 'Local draft stays intact');
  } finally {
    await fixture.close();
  }
});

test('different-account browser re-auth (A -> B) runs through DesktopFormalSessionGate, clears queryClient, and resets all un-scoped Zustand state', async () => {
  let switchToAccountB!: () => void;
  const fixture = await setupStripHarness({
    withFormalGate: true,
    complete: async () => {
      switchToAccountB();
      return { user: { id: 'account-b', displayName: 'User B', realmEnvironmentId: 'realm-a' } };
    },
  });
  try {
    // Admit Account A into DesktopFormalSessionGate.
    assert.equal(fixture.formalProbes.length, 1);
    await act(async () => fixture.formalProbes[0]!.resolve(READY_SESSION));
    assert.deepEqual(fixture.mountedAccounts, ['account-a']);
    assert.ok(fixture.query('[data-testid="offline-strip-reauth-button"]'));

    // Seed global fields (must survive A -> B).
    fixture.store.getState().setBootstrapReady(true);
    fixture.store.getState().setPrimaryRailVisible(false);

    // Seed TanStack query cache and ALL un-scoped Zustand view/selection fields for Account A.
    fixture.queryClient.setQueryData(['chats', 'account-a'], [{ id: 'chat-secret-a' }]);
    fixture.store.getState().setChatSourceFilter('human');
    fixture.store.getState().setChatViewMode('human', 'peer-a', 'chat');
    fixture.store.getState().setLastSelectedThreadForMode('ai', 'ai-thread-a');
    fixture.store.getState().setLastSelectedThreadForMode('human', 'human-thread-a');
    fixture.store.getState().setChatSetupState('ai', createReadyConversationSetupState('ai'));
    fixture.store.getState().setChatSetupState('human', createReadyConversationSetupState('human'));
    fixture.store.getState().setRuntimeFields({
      targetType: 'agent',
      targetAccountId: 'account-a-target',
      agentId: 'agent-a',
      targetId: 'target-a',
      worldId: 'world-a',
      mode: 'SCENE_TURN',
      turnIndex: 4,
      userConfirmedUpload: true,
    });
    fixture.store.getState().setHomePartnerDraft('account-a', 'partner-a', 'Private draft from A');
    fixture.store.getState().setPendingNimiComposerPrefill('Private prefill from A');
    fixture.store.getState().setProfileDetailOverlayOpen(true);

    switchToAccountB = () => {
      fixture.store.getState().applyRuntimeAccountProjection({
        status: 'authenticated',
        sequence: '20',
        reasonCode: RuntimeReasonCode.ACTION_EXECUTED,
        accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
        authorizationRevision: 'authorization-b',
        user: { id: 'account-b', displayName: 'User B', realmEnvironmentId: 'realm-a' },
      });
      fixture.store.getState().setOfflineTier('L0');
    };

    // Click the in-place re-auth button in OfflineShellStrip; browser completes as Account B.
    await act(async () => {
      fixture.query<HTMLButtonElement>('[data-testid="offline-strip-reauth-button"]')!.click();
    });
    await fixture.settle();

    // DesktopFormalSessionGate must hide Account A immediately, clear TanStack cache, and probe B.
    assert.equal(fixture.formalProbes.length, 2);
    assert.equal(fixture.query('[data-testid="protected-shell-child"]'), null);
    assert.equal(fixture.queryClient.getQueryData(['chats', 'account-a']), undefined);

    // Every un-scoped Zustand view/selection field must be reset before Account B mounts.
    const stateForB = fixture.store.getState();
    assert.equal(stateForB.auth.user?.id, 'account-b');
    assert.equal(stateForB.chatSourceFilter, 'all');
    assert.deepEqual(stateForB.viewModeBySourceTarget, {});
    assert.deepEqual(stateForB.lastSelectedThreadByMode, { ai: null, human: null });
    assert.deepEqual(stateForB.chatSetupState, { ai: null, human: null });
    assert.deepEqual(stateForB.runtimeFields, INITIAL_RUNTIME_FIELDS);
    assert.deepEqual(stateForB.homePartnerDrafts, {});
    assert.equal(stateForB.pendingNimiComposerPrefill, null);
    assert.equal(stateForB.profileDetailOverlayOpen, false);

    // Global fields stay intact.
    assert.equal(stateForB.bootstrapReady, true);
    assert.equal(stateForB.primaryRailVisible, false);
    assert.equal(stateForB.offlineTier, 'L0');

    // Admit Account B: child mounts cleanly as B with offline strip gone.
    await act(async () => fixture.formalProbes[1]!.resolve(READY_SESSION));
    assert.deepEqual(fixture.mountedAccounts, ['account-a', 'account-b']);
    assert.equal(fixture.query('[data-testid="shell-account"]')?.textContent, 'account-b');
    assert.equal(fixture.query(`[data-testid="${E2E_IDS.offlineStrip}"]`), null);
  } finally {
    await fixture.close();
  }
});
