import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

function setupDom() {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLFormElement: dom.window.HTMLFormElement, Element: dom.window.Element, Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event, KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle, ResizeObserver: Observer,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    dom,
    restore: () => {
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

test('contacts page consumes pagination and submits only the request identity the user saw', async () => {
  const { dom, restore } = setupDom();
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
    getMyPendingFriendRequests: async (request: { query: { direction: string } }) => { if (request.query.direction === 'sent') pendingListReads++; return { items: [{ userId: 'Carol', displayName: 'Carol', handle: 'carol', relationshipId: requestId, avatarUrl: null, isDeleted: false, requestMessage: 'Hello' }], nextCursor: null, total: 1 }; },
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
    assert.ok(dom.window.document.querySelector('[aria-label="View Alice’s profile"]'));
    assert.equal(button('Sent requests'), undefined, 'requests are not top-level tabs');
    assert.equal(dom.window.document.querySelector('[aria-label="Manage contacts"]'), null, 'no duplicate header overflow menu');
    const messageBtn = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Message"]');
    assert.ok(messageBtn, 'quick message action is directly rendered');
    assert.equal(messageBtn.closest('.opacity-0'), null, 'quick message action does not rely on hover opacity-0');
    await act(async () => button('Load more').click()); await settle();
    assert.equal(dom.window.document.querySelectorAll('li').length, 2, 'page overlap does not duplicate a person');
    assert.deepEqual(pages, [{ path: {}, query: { limit: 30 } }, { path: {}, query: { limit: 30, cursor: 'page-2' } }]);
    await act(async () => [...dom.window.document.querySelectorAll('button')].find(element => element.textContent?.startsWith('Friend requests'))!.click()); await settle();
    assert.ok(dom.window.document.querySelector('[role="radiogroup"]'), 'requests sub-view uses SegmentedControl');
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
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 40)); }); client.clear(); store.navigation.dispose(); restore();
  }
});

test('contacts panel handles zero-friend empty state, search-to-add prefill, inline blocked relationship and Escape hierarchy', async () => {
  const { dom, restore } = setupDom();
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { RealmHumanChatDataProvider } = await import('../src/shell/renderer/features/chat/data/realm-human-chat-data-context.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { HumanContactsPanel } = await import('../src/shell/renderer/features/relationship/human-contacts-panel.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.setState({ auth: { status: 'authenticated', sequence: '1', reasonCode: 0, accountReasonCode: 0, authorizationRevision: 'one', user: { id: 'account-a', handle: 'eric_nimi' } } });

  let friendItems: Array<Record<string, unknown>> = [];
  const copied: string[] = [];
  const realm = {
    generated: {
      listMyFriendsWithDetails: async (request: { query: { query?: string } }) => {
        const q = (request.query.query || '').toLowerCase();
        const items = q ? friendItems.filter(item => String(item.displayName).toLowerCase().includes(q)) : friendItems;
        return { items, nextCursor: null, total: items.length };
      },
      getMyPendingFriendRequests: async () => ({ items: [], nextCursor: null, total: 0 }),
      getMyBlockedUsers: async () => ({
        items: [
          { id: 'u-blocked-1', displayName: 'Blocked One', handle: 'blocked1', avatarUrl: null, isDeleted: false },
          { id: 'u-blocked-2', displayName: 'Blocked Two', handle: 'blocked2', avatarUrl: null, isDeleted: false },
        ],
        nextCursor: null,
        total: 2,
      }),
    },
    social: {
      getMyRelationshipWithUser: async () => ({
        userId: 'u-blocked-1',
        relationshipId: 'rel-blocked-1',
        state: 'active',
        blockedByMe: true,
        canMessage: false,
        canRequest: false,
      }),
    },
  };
  const bindings = {
    sdk: { realm: () => realm, socialData: { callApi: async () => ({ outcome: 'requested' }) } },
    app: { commands: { writeClipboardText: async (value: string) => { copied.push(value); } } },
  } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  const buttonMatching = (pattern: RegExp) => [...dom.window.document.querySelectorAll('button')].find(el => pattern.test(el.textContent ?? ''));

  let parentSawEscape = false;
  try {
    await act(async () => root.render(
      <div onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) parentSawEscape = true; }}>
        <QueryClientProvider client={client}>
          <AppStoreProvider store={store}>
            <DesktopRendererBindingProvider bindings={bindings}>
              <RealmHumanChatDataProvider resource={{ loadChatList: async () => ({ items: [], nextCursor: null }) } as never}>
                <DesktopI18nResourceProvider resource={productionDesktopI18n}>
                  <DesktopMotionProvider><HumanContactsPanel /></DesktopMotionProvider>
                </DesktopI18nResourceProvider>
              </RealmHumanChatDataProvider>
            </DesktopRendererBindingProvider>
          </AppStoreProvider>
        </QueryClientProvider>
      </div>,
    ));
    await settle();

    // 1. Zero-friend state hides filter search input, shows actionable empty state + my handle copy card.
    assert.equal(dom.window.document.querySelector('input[type="search"]'), null, 'search filter is hidden when zero friends');
    assert.ok(dom.window.document.querySelector('[data-testid="friends-empty-state"]'));
    assert.ok(dom.window.document.querySelector('[data-testid="my-handle-share-card"]'));
    assert.ok(buttonMatching(/^Blocked$/), 'Blocked entry is directly reachable in 1 click');
    await act(async () => { buttonMatching(/^Copy$/)?.click(); });
    assert.deepEqual(copied, ['@eric_nimi']);

    // 2. Clicking primary CTA opens inline Add Friend sub-view; Escape returns to Friends without bubbling to outer drawer.
    await act(async () => { buttonMatching(/^Add a friend$/)?.click(); });
    await settle();
    assert.ok(dom.window.document.querySelector('[data-testid="friend-handle-lookup"]'));
    await act(async () => {
      dom.window.document.querySelector('[data-testid="human-contacts-panel"]')!.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    assert.equal(dom.window.document.querySelector('[data-testid="friend-handle-lookup"]'), null, 'Escape exits Add Friend sub-view');
    assert.equal(parentSawEscape, false, 'Escape in sub-view does not bubble to close outer drawer');

    // 3. Blocked view renders relationship management inline inside the clicked row's <li>.
    await act(async () => { buttonMatching(/^Blocked$/)?.click(); });
    await settle();
    const blockedRows = [...dom.window.document.querySelectorAll('li')];
    assert.equal(blockedRows.length, 2);
    const manageBtn = blockedRows[0]!.querySelectorAll('button')[2]!;
    assert.match(manageBtn.textContent ?? '', /Manage relationship/);
    await act(async () => { manageBtn.click(); });
    await settle();
    const inlinePanel = blockedRows[0]!.querySelector('[data-testid="blocked-relationship-inline"]');
    assert.ok(inlinePanel, 'blocked relationship details expand inline inside the selected row');
    assert.match(inlinePanel.textContent ?? '', /still friends/i);

    // Return to friends view and load a friend to exercise search-to-add prefill.
    await act(async () => { buttonMatching(/^Friends$/)?.click(); });
    friendItems = [{ id: 'u-1', relationshipId: 'rel-1', displayName: 'Alice', handle: 'alice', avatarUrl: null, isDeleted: false }];
    await act(async () => { await client.invalidateQueries({ queryKey: ['human-contacts'] }); });
    await settle();

    const searchInput = dom.window.document.querySelector<HTMLInputElement>('input[type="search"]')!;
    assert.ok(searchInput, 'search filter appears when friends exist');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(searchInput, 'newfriend');
      searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await settle();
    assert.ok(dom.window.document.querySelector('[data-testid="friends-search-empty"]'));
    const prefillBtn = buttonMatching(/Add @newfriend by username/);
    assert.ok(prefillBtn, 'search no-match bridges to Add Friend with handle prefill');
    await act(async () => { prefillBtn.click(); });
    await settle();
    const addInput = dom.window.document.querySelector<HTMLInputElement>('[data-testid="friend-handle-lookup"] input');
    assert.equal(addInput?.value, '@newfriend', 'Add Friend sub-view prefills the searched handle');
  } finally {
    await act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 40)); });
    client.clear(); store.navigation.dispose(); restore();
  }
});
