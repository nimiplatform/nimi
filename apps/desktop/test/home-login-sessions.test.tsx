import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Home session controls bind pagination and revocation to the displayed owner and distinguish current from other sessions', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    ResizeObserver: Observer,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { AppStoreProvider } =
    await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } =
    await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } =
    await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopI18nResourceProvider } =
    await import('../src/shell/renderer/i18n/i18n-context.js');
  const { productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopMotionProvider } =
    await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { OwnedLoginSessions } =
    await import('../src/shell/renderer/features/settings/home-login-sessions.js');
  await initI18n();
  await changeLocale('en');
  const store = createAppStore({
    initialChatThinkingPreference: 'off',
    persistChatThinkingPreference: () => {},
  });
  store.setState({
    auth: {
      status: 'authenticated',
      sequence: '1',
      reasonCode: 0,
      accountReasonCode: 0,
      authorizationRevision: 'one',
      user: { id: 'account-a', realmEnvironmentId: 'test-realm' },
    },
  });
  const calls: Array<{ kind: string; input: unknown }> = [];
  const login = (id: string, current: boolean) => ({
    id,
    current,
    createdAt: '2026-10-31T01:00:00Z',
    authenticatedAt: null,
  });
  let hasOther = true;
  let readFails = false;
  let localExits = 0;
  const bindings = {
    sdk: {
      realm: () => ({
        generated: {
          listMyAccountSessions: async (input: {
            query: { cursor?: string; expectedAccountId: string };
          }) => {
            calls.push({ kind: 'list', input });
            if (readFails) throw new Error('offline');
            return input.query.cursor
              ? {
                  items: [login('other-session', false)],
                  nextCursor: null,
                  recentAuthentication: false,
                }
              : {
                  items: [login('home-session', true)],
                  nextCursor: hasOther ? 'next' : null,
                  recentAuthentication: false,
                };
          },
          revokeMyAccountSession: async (input: {
            path: { sessionId: string };
            body: { expectedAccountId: string };
          }) => {
            calls.push({ kind: 'selected', input });
            hasOther = false;
            readFails = input.path.sessionId !== 'home-session';
            return { currentRevoked: input.path.sessionId === 'home-session', revokedCount: 1 };
          },
          revokeMyOtherAccountSessions: async (input: unknown) => {
            calls.push({ kind: 'others', input });
            hasOther = false;
            return { currentRevoked: false, revokedCount: 1 };
          },
        },
      }),
    },
  } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const button = (label: string, dialog = false) => {
    const selector = dialog ? '[role="dialog"] button, [role="alertdialog"] button' : 'button';
    const found = [...dom.window.document.querySelectorAll<HTMLButtonElement>(selector)].find(
      (el) => el.textContent === label,
    );
    assert.ok(found, label);
    return found;
  };
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });
  const click = async (label: string, dialog = false) => {
    await act(async () => button(label, dialog).click());
    await settle();
  };
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AppStoreProvider store={store}>
            <DesktopRendererBindingProvider bindings={bindings}>
              <DesktopI18nResourceProvider resource={productionDesktopI18n}>
                <DesktopMotionProvider>
                  <OwnedLoginSessions
                    accountId="account-a"
                    environment="test-realm"
                    onCurrentRevoked={async () => {
                      localExits++;
                    }}
                  />
                </DesktopMotionProvider>
              </DesktopI18nResourceProvider>
            </DesktopRendererBindingProvider>
          </AppStoreProvider>
        </QueryClientProvider>,
      ),
    );
    await settle();
    await click('Load more sign-ins');
    assert.deepEqual(calls.filter((call) => call.kind === 'list').at(-1)?.input, {
      path: {},
      query: { expectedAccountId: 'account-a', limit: 20, cursor: 'next' },
    });
    await click('Sign out this session');
    await click('Sign out this session', true);
    assert.deepEqual(calls.find((call) => call.kind === 'selected')?.input, {
      path: { sessionId: 'other-session' },
      body: { expectedAccountId: 'account-a' },
    });
    assert.equal(localExits, 0);
    assert.match(
      dom.window.document.body.textContent!,
      /selected login sessions have been signed out/,
    );
    assert.match(dom.window.document.body.textContent!, /Could not load the latest sign-ins/);
    assert.doesNotMatch(dom.window.document.body.textContent!, /Other login · source unknown/);
    readFails = false;
    hasOther = true;
    await click('Refresh sign-ins');
    await click('Sign out all other sessions');
    await click('Sign out all other sessions', true);
    assert.deepEqual(calls.find((call) => call.kind === 'others')?.input, {
      path: {},
      body: { expectedAccountId: 'account-a' },
    });
    assert.equal(localExits, 0);
    await click('Sign out of this Home session');
    const auth = store.getState().auth;
    store.setState({ auth: { ...auth, user: { ...auth.user, id: 'account-b' } } });
    store.setState({ auth });
    await click('Sign out of this Home session', true);
    assert.equal(calls.filter((call) => call.kind === 'selected').length, 1);
    await click('Sign out of this Home session');
    await click('Sign out of this Home session', true);
    assert.equal(localExits, 1);
  } finally {
    // The dialog returns focus on the next task after unmount.
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    client.clear();
    store.navigation.dispose();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
