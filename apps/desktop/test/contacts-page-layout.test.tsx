import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export default {};' };
    }
    if (/\.(png|svg|webp|jpg|jpeg)$/i.test(url)) {
      return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
    }
    return nextLoad(url, context);
  },
});

test('ContactsPage dynamically switches right rail to searchable Contacts panel and replaces main pane with User/Agent profile on selection', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class Observer { observe() {} unobserve() {} disconnect() {} }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
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
    IntersectionObserver: Observer,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { RealmHumanChatDataProvider } = await import('../src/shell/renderer/features/chat/data/realm-human-chat-data-context.js');
  const { RealmSocialDataProvider } = await import('../src/shell/renderer/features/social/data/realm-social-data-context.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { SystemEntryProviderContext } = await import('../src/shell/renderer/features/system-entry/system-entry-context.js');
  const { ContactsPage } = await import('../src/shell/renderer/features/chat/contacts-page.js');

  await initI18n();
  await changeLocale('en');

  const accountId = 'account-a';
  const partnerRef = 'local-agent:11111111-1111-4111-8111-111111111111';
  const partnerRecord = {
    localAgentRef: partnerRef,
    ownerUserId: accountId,
    runtimeSourceRef: 'source-laurent',
    displayName: '洛朗·德·瓦尔蒙',
    lifecycleStatus: AgentLifecycleStatus.ACTIVE,
  };

  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.setState({
    auth: {
      status: 'authenticated',
      sequence: '1',
      reasonCode: 0,
      accountReasonCode: 0,
      authorizationRevision: 'rev-1',
      user: { id: accountId },
    },
  });
  await store.navigation.replace({ id: 'contacts' });

  const friend = (id: string, displayName: string, handle: string) => ({
    id,
    relationshipId: `rel-${id}`,
    displayName,
    handle,
    avatarUrl: null,
    isDeleted: false,
  });

  const realm = {
    generated: {
      listMyFriendsWithDetails: async (request: { query: { search?: string } }) => {
        const all = [friend('eric', 'Eric', 'eric'), friend('bob', 'Bob', 'bob')];
        const q = (request.query.search || '').toLowerCase();
        const items = q ? all.filter(item => item.displayName.toLowerCase().includes(q)) : all;
        return { items, nextCursor: null, total: items.length };
      },
      getMyPendingFriendRequests: async () => ({ items: [], nextCursor: null, total: 0 }),
    },
    social: {
      getMyRelationshipWithUser: async ({ path }: { path: { id: string } }) => ({
        userId: path.id,
        relationshipId: `rel-${path.id}`,
        state: 'active',
        blockedByMe: false,
        canMessage: true,
        canRequest: false,
      }),
    },
  };

  const sdk = {
    realm: () => realm,
    appProduct: () => ({
      agents: {
        listReferences: async () => [],
      },
    }),
    accountProduct: () => ({
      agents: {
        listAgents: async () => ({ agents: [partnerRecord], nextPageToken: '' }),
        getAgent: async ({ agentId }: { agentId: string }) => ({
          agent: agentId === partnerRef ? partnerRecord : undefined,
        }),
      },
    }),
    withRuntimeProtectedScopes: async (_scopes: string[], fn: (options: Record<string, never>) => Promise<unknown>) => fn({}),
    resolveDesktopAgentReference: async () => ({ reference: null }),
  };
  const bindings = {
    sdk,
    app: { commands: { avatarHandoff: { available: () => false } } },
  };

  const socialResource = {
    contacts: () => ({ friends: [{ id: 'eric', displayName: 'Eric', handle: 'eric', avatarUrl: null }] }),
    loadUserProfile: async (id: string) => ({
      id,
      displayName: id === 'eric' ? 'Eric' : id,
      handle: id,
      bio: 'Midnight architect in Realm.',
      avatarUrl: null,
    }),
  };

  let chatListItems: Array<Record<string, unknown>> = [];
  let chatListUnavailable = false;
  const chatResource = {
    loadChatList: async () => {
      if (chatListUnavailable) throw new Error('Conversation list unavailable');
      return { items: chatListItems, nextCursor: null };
    },
    startChatWithTarget: async (targetId: string) => ({ chatId: `thread-${targetId}` }),
  };

  const emptyActivitySnapshot = { status: 'ready' as const, records: [], hasMore: false, loadingMore: false, errorMessage: null };
  const systemEntry = {
    hostContext: null,
    homeVisible: true,
    projection: null,
    appActivity: {
      pending: emptyActivitySnapshot,
      recent: emptyActivitySnapshot,
      busy: {},
      notices: {},
      open: () => {},
      markRead: () => {},
      retry: () => {},
      loadMore: () => {},
    },
    recentPartners: [],
    ai: null,
    refresh: async () => {},
    openAIActivity: async () => {},
  };

  const root = createRoot(dom.window.document.getElementById('root')!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AppStoreProvider store={store}>
            <DesktopRendererBindingProvider bindings={bindings as never}>
              <RealmHumanChatDataProvider resource={chatResource as never}>
                <RealmSocialDataProvider resource={socialResource as never}>
                  <DesktopI18nResourceProvider resource={productionDesktopI18n}>
                    <DesktopMotionProvider>
                      <TooltipProvider>
                        <SystemEntryProviderContext.Provider value={systemEntry}>
                          <ContactsPage />
                        </SystemEntryProviderContext.Provider>
                      </TooltipProvider>
                    </DesktopMotionProvider>
                  </DesktopI18nResourceProvider>
                </RealmSocialDataProvider>
              </RealmHumanChatDataProvider>
            </DesktopRendererBindingProvider>
          </AppStoreProvider>
        </QueryClientProvider>,
      );
    });
    await settle();

    // 1. Default 0-conversation state renders compact right rail, brand watermark, and primary onboarding CTA to discover partners.
    assert.equal(
      dom.window.document.querySelector('[data-contacts-rail-state]')?.getAttribute('data-contacts-rail-state'),
      'compact',
    );
    assert.ok(dom.window.document.querySelector('[data-testid="chat-list"]'), 'compact avatar rail is shown initially');
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-right-panel"]'), null);
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-empty-stage"]')?.getAttribute('data-empty-stage-mode'), 'zero-conversations');
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-empty-stage"] .nimi-empty-state'), null);
    assert.ok(dom.window.document.querySelector('[data-testid="contacts-empty-stage"] [data-testid="contacts-watermark"]'));
    const discoverCta = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="contacts-empty-discover-cta"]');
    assert.ok(discoverCta, 'zero-conversations renders primary discover partners CTA');
    assert.equal(discoverCta.textContent?.trim(), 'Discover partners');

    await act(async () => { discoverCta.click(); });
    assert.equal(store.navigation.getSnapshot().current.destination.id, 'explore');
    assert.equal(store.navigation.getSnapshot().current.destination.exploreSection, 'worlds');
    assert.equal(store.navigation.getSnapshot().current.destination.exploreSearchKind, 'characters');
    await act(async () => { await store.navigation.replace({ id: 'contacts' }); });
    await settle();

    chatListUnavailable = true;
    await act(async () => { await client.invalidateQueries({ queryKey: ['chats'] }); });
    await settle();
    assert.match(dom.window.document.body.textContent ?? '', /Could not load your conversations/);
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-empty-stage"]'), null);
    const retry = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === 'Retry');
    assert.ok(retry);
    chatListUnavailable = false;
    await act(async () => retry.click());
    await settle();
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-empty-stage"]')?.getAttribute('data-empty-stage-mode'), 'zero-conversations');
    assert.ok(dom.window.document.querySelector('[data-testid="contacts-empty-discover-cta"]'));

    // 2. Clicking the persistent bottom Contacts button morphs the same rail into expanded form and keeps center stage as quiet watermark.
    const contactsEntry = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="human-contacts-entry"]');
    assert.ok(contactsEntry);
    assert.equal(contactsEntry.getAttribute('aria-expanded'), 'false');
    await act(async () => { contactsEntry.click(); });
    await settle();

    assert.equal(
      dom.window.document.querySelector('[data-contacts-rail-state]')?.getAttribute('data-contacts-rail-state'),
      'expanded',
    );
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-empty-stage"]')?.getAttribute('data-empty-stage-mode'), 'contacts-open');
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-empty-stage"]')?.textContent ?? '', '');
    const rightPanel = dom.window.document.querySelector('[data-testid="contacts-right-panel"]');
    assert.ok(rightPanel, 'right Contacts panel opens');
    assert.equal(dom.window.document.querySelector('[data-testid="chat-list"]'), null, 'compact avatar list morphs into Contacts panel');
    assert.equal(
      dom.window.document.querySelector('[data-testid="human-contacts-entry"]')?.getAttribute('aria-expanded'),
      'true',
      'persistent bottom Contacts button remains mounted in active state',
    );
    assert.ok(rightPanel.querySelector('input[type="search"], input[placeholder*="Search"]'), 'Friends search field is rendered');

    // 3. Clicking a Friend row replaces the main pane with User Profile while keeping right Contacts panel open.
    const ericButton = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="View Eric’s profile"]');
    assert.ok(ericButton, 'Eric contact row is rendered');
    await act(async () => { ericButton.click(); });
    await settle();
    await settle();

    assert.equal(store.navigation.getSnapshot().current.destination.profileId, 'eric');
    assert.ok(dom.window.document.querySelector('[data-testid="panel:profile"]'), 'main pane renders User Profile');
    assert.match(dom.window.document.body.textContent ?? '', /Midnight architect in Realm/);
    assert.ok(dom.window.document.querySelector('[data-testid="contacts-right-panel"]'), 'right Contacts panel stays open alongside User Profile');
    assert.equal(
      dom.window.document.querySelector('[aria-label="View Eric’s profile"]')?.getAttribute('aria-current'),
      'true',
    );

    // 4. Switching right panel tab to Partners and clicking a Partner replaces main pane with Agent Profile.
    const partnersTab = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(tab => tab.textContent?.trim() === 'Partners');
    assert.ok(partnersTab, 'Partners tab exists in right panel');
    await act(async () => { partnersTab.click(); });
    await settle();

    const partnerRow = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="partner-row"]');
    assert.ok(partnerRow, 'Partner row renders in right panel');
    assert.match(partnerRow.textContent ?? '', /洛朗·德·瓦尔蒙/);
    await act(async () => { partnerRow.click(); });
    await settle();
    await settle();

    assert.equal(store.navigation.getSnapshot().current.destination.partner?.localAgentRef, partnerRef);
    assert.ok(dom.window.document.querySelector('[aria-label="Partner details"]'), 'main pane renders Agent Profile');
    assert.ok(dom.window.document.querySelector('[data-testid="contacts-right-panel"]'), 'right Contacts panel stays open alongside Agent Profile');

    // 5. Clicking the persistent bottom Contacts button again morphs the rail back to compact form while keeping Agent Profile in main pane.
    const persistentToggle = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="human-contacts-entry"]');
    assert.ok(persistentToggle);
    await act(async () => { persistentToggle.click(); });
    await settle();

    assert.equal(
      dom.window.document.querySelector('[data-contacts-rail-state]')?.getAttribute('data-contacts-rail-state'),
      'compact',
    );
    assert.equal(dom.window.document.querySelector('[data-testid="contacts-right-panel"]'), null);
    assert.ok(dom.window.document.querySelector('[data-testid="chat-list"]'), 'compact avatar rail returns');
    assert.ok(dom.window.document.querySelector('[aria-label="Partner details"]'), 'main pane preserves Agent Profile');

    // 6. When conversations exist on the current side and none is selected, center stage keeps quiet watermark without text pill or CTA.
    chatListItems = [{
      id: 'chat-eric',
      otherUser: { id: 'eric', displayName: 'Eric', handle: 'eric', avatarUrl: null },
      lastMessage: { text: 'Hello', createdAt: '2026-11-18T00:00:00.000Z' },
      unreadCount: 0,
    }];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['chats'] });
      await store.navigation.push({ id: 'contacts' });
    });
    await settle();
    await settle();

    assert.equal(
      dom.window.document.querySelector('[data-testid="contacts-empty-stage"]')?.getAttribute('data-empty-stage-mode'),
      'has-conversations',
    );
    assert.ok(dom.window.document.querySelector('[data-testid="contacts-empty-stage"] [data-testid="contacts-watermark"]'));
    assert.equal(
      dom.window.document.querySelector('[data-testid="contacts-empty-stage"]')?.textContent ?? '',
      '',
    );
  } finally {
    await act(async () => {
      root.unmount();
      await new Promise(resolve => setTimeout(resolve, 40));
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
