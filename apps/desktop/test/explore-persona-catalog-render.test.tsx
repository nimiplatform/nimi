import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('character discovery stays in Worlds and pages world choices within the selected topic', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, getComputedStyle: dom.window.getComputedStyle,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { ExplorePanel } = await import('../src/shell/renderer/features/explore/explore-panel.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  await store.navigation.push({ id: 'explore', exploreSearchKind: 'characters' });
  store.getState().setBootstrapReady(true);
  const worlds = Array.from({ length: 91 }, (_, index) => ({
    id: `world-${index + 1}`, name: `World ${index + 1}`, summary: 'A public world', type: 'CREATOR', visibility: 'public',
    topicIds: index >= 50 ? ['comedy'] : [], media: {}, stats: {}, entityKinds: [], relationshipTypes: [],
    time: { mode: 'static' }, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }));
  const characterRequests: { topicId?: string; worldId?: string }[] = [];
  const worldPublic = {
    worldPublicControllerListWorldTopics: async () => [{ id: 'comedy', title: '轻喜剧', titleEn: 'Comedy' }],
    worldPublicControllerListWorldCatalog: async ({ query }: { query: { topicId?: string; cursor?: string; limit: number } }) => {
      const { topicId } = query;
      const rows = topicId ? worlds.filter(world => world.topicIds.includes(topicId)) : worlds;
      const start = Number(query.cursor ?? 0);
      const items = rows.slice(start, start + query.limit);
      const hasMore = start + items.length < rows.length;
      return { items, hasMore, nextCursor: hasMore ? String(start + items.length) : null, totalCount: rows.length };
    },
    worldPublicControllerListCharacterCatalog: async ({ query }: { query: typeof characterRequests[number] }) => {
      characterRequests.push(query);
      return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
    },
  };
  const realm = () => ({ worldPublic });
  const bindings = { sdk: { realm, socialData: { callApi: (read: (api: ReturnType<typeof realm>) => unknown) => read(realm()), emitDataError() {} } } } as never;
  const client = new QueryClient();
  const root = createRoot(dom.window.document.getElementById('root')!);
  const document = dom.window.document;
  const waitFor = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 50 && !condition(); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
    assert.ok(condition());
  };
  const option = (id: string) => document.querySelector(`select option[value="${id}"]`);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}>
      <DesktopRendererBindingProvider bindings={bindings}><ExplorePanel activeSection="worlds" searchText=""
        onSectionChange={() => {}} onSearchTextChange={() => {}} /></DesktopRendererBindingProvider>
    </AppStoreProvider></QueryClientProvider>));
    assert.deepEqual([...document.querySelectorAll('[role="tab"]')].map(tab => [tab.textContent, tab.getAttribute('aria-selected')]), [['Worlds', 'true']]);
    await waitFor(() => !!option('world-1'));
    assert.equal(option('world-51'), null);
    await act(async () => document.querySelector<HTMLButtonElement>('[data-topic-id="comedy"]')!.click());
    await waitFor(() => !!option('world-51'));
    assert.equal(option('world-1'), null);
    assert.equal(option('world-91'), null);
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Load more worlds')!.click());
    await waitFor(() => !!option('world-91'));
    const select = document.querySelector('select')!;
    await act(async () => {
      select.value = 'world-91';
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.deepEqual(characterRequests.at(-1), { worldId: 'world-91', topicId: 'comedy', limit: 24 });
  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
