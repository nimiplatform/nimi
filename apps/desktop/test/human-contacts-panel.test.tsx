import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('contacts page consumes pagination and submits only the request identity the user saw', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLFormElement: dom.window.HTMLFormElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle, ResizeObserver: Observer,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { RealmHumanChatDataProvider } = await import('../src/shell/renderer/features/chat/data/realm-human-chat-data-context.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { HumanContactsPanel } = await import('../src/shell/renderer/features/relationship/human-contacts-panel.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.setState({ auth: { status: 'authenticated', sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'one', user: { id: 'account-a' } } });
  const pages: unknown[] = [];
  const actions: unknown[] = [];
  let requestId = 'request-old';
  let pendingListReads = 0;
  const friend = (id: string) => ({ id, relationshipId: 'friend-' + id, displayName: id, handle: id, avatarUrl: null, isDeleted: false });
  const realm = { generated: {
    listMyFriendsWithDetails: async (request: { query: { cursor?: string } }) => { pages.push(request); return request.query.cursor
      ? { items: [friend('Alice'), friend('Bob')], nextCursor: null, total: 2 }
      : { items: [friend('Alice')], nextCursor: 'page-2', total: 2 }; },
    getMyPendingFriendRequests: async () => { pendingListReads++; return { items: [{ userId: 'Carol', displayName: 'Carol', handle: 'carol', relationshipId: requestId, avatarUrl: null, isDeleted: false, requestMessage: 'Hello' }], nextCursor: null, total: 1 }; },
  }, social: {
    applyFriendshipAction: async (request: unknown) => { actions.push(request); throw new Error('Relationship changed. Refresh the list.'); },
  } };
  const bindings = { sdk: { realm: () => realm } } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const button = (text: string) => [...dom.window.document.querySelectorAll('button')].find(element => element.textContent === text)!;
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}>
      <DesktopRendererBindingProvider bindings={bindings}><RealmHumanChatDataProvider resource={{ loadChatList: async () => ({ items: [], nextCursor: null }) } as never}><DesktopI18nResourceProvider resource={productionDesktopI18n}>
        <DesktopMotionProvider><HumanContactsPanel /></DesktopMotionProvider>
      </DesktopI18nResourceProvider></RealmHumanChatDataProvider></DesktopRendererBindingProvider>
    </AppStoreProvider></QueryClientProvider>));
    await settle();
    assert.ok(button('Alice'));
    await act(async () => button('Load more').click()); await settle();
    assert.equal(dom.window.document.querySelectorAll('li').length, 2, 'page overlap does not duplicate a person');
    assert.deepEqual(pages, [{ path: {}, query: { limit: 30 } }, { path: {}, query: { limit: 30, cursor: 'page-2' } }]);
    await act(async () => button('Sent requests').click()); await settle();
    requestId = 'request-new';
    await act(async () => button('Cancel request').click()); await settle();
    assert.deepEqual(actions, [{ path: { id: 'Carol' }, body: { action: 'cancel', relationshipId: 'request-old' } }]);
    assert.equal(pendingListReads, 1, 'mutation must not replace the identity the user saw with a fresh lookup');
    assert.match(dom.window.document.body.textContent!, /Relationship changed/);
    await act(async () => button('Refresh list').click()); await settle();
    await act(async () => button('Cancel request').click()); await settle();
    assert.deepEqual(actions[1], { path: { id: 'Carol' }, body: { action: 'cancel', relationshipId: 'request-new' } });
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 40)); }); client.clear(); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
