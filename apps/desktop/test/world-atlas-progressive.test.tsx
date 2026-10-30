import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { RealmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data.js';

// Deferred reads exercise real Query/React behavior; this is regression coverage,
// not a substitute for acceptance against the running Home and Realm.
test('one resolved lead is usable before the other four, without jumping as they arrive', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClientProvider } = await import('@tanstack/react-query');
  const { createDesktopQueryClient } = await import('../src/shell/renderer/infra/query-client/query-client.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { useWorldAtlasLeadWorlds } = await import('../src/shell/renderer/features/world/world-atlas-data.js');
  const { WorldCatalogContent } = await import('../src/shell/renderer/features/world/world-list.js');
  const { worldListItemQueryKey } = await import('../src/shell/renderer/features/world/world-detail-queries.js');
  const { WORLD_ATLAS_LEAD_WORLD_IDS } = await import('../src/shell/renderer/features/world/world-list-catalog-model.js');
  await initI18n(); await changeLocale('en');
  const reads = new Map<string, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const data = { loadWorldDetailById: (id: string) => new Promise((resolve, reject) => { reads.set(id, { resolve, reject }); }) } as RealmWorldData;
  const client = createDesktopQueryClient();
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const realmBaseUrl = 'https://realm.test';
  function Harness() {
    const spotlight = useWorldAtlasLeadWorlds({ data, realmBaseUrl, enabled: true, offline: false });
    return <WorldCatalogContent worlds={[]} loading leadWorlds={spotlight.worlds}
      spotlightLoading={spotlight.loading} spotlightError={spotlight.error} onRetrySpotlight={spotlight.retry}
      paging={{ totalCount: 0, hasMore: false, loadingMore: false, loadMoreFailed: false, offlineIncomplete: false, onLoadMore() {} }} />;
  }
  const settle = async () => {
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const resolve = async (id: string) => {
    await act(async () => { reads.get(id)!.resolve({ id, name: id, summary: `World ${id}`, type: 'CREATOR',
      media: {}, stats: {}, time: { mode: 'static' }, bannerUrl: `https://example.com/${id}.png` }); });
    await settle();
  };
  const activeId = () => dom.window.document.querySelector('.world-atlas-hero')?.getAttribute('data-world-id');
  const click = async (selector: string) => {
    await act(async () => { dom.window.document.querySelector<HTMLButtonElement>(selector)!.click(); });
  };
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}><Harness /></AppStoreProvider></QueryClientProvider>); });
    assert.equal(reads.size, 5);
    assert.equal(activeId(), undefined);
    await resolve('d10');
    assert.equal(activeId(), 'd10', 'the first response renders while four reads and the catalog are pending');
    assert.equal(dom.window.document.querySelector('.world-atlas-hero img')?.getAttribute('src'), 'https://example.com/d10.png');
    await resolve('z01');
    assert.equal(activeId(), 'd10', 'an earlier-sorted response must not replace the visible World');
    await click('button[aria-label="Previous world"]');
    assert.equal(activeId(), 'z01');
    await act(async () => { reads.get('thinink-plains')!.reject(new Error('Unavailable')); });
    await resolve('cwe-b03-u09'); await resolve('z03');
    assert.equal(activeId(), 'z01', 'a failed lead must not hide usable entries');
    assert.equal(dom.window.document.querySelectorAll('.world-atlas-hero-dots button').length, 4);
    await click('button[aria-label="Previous world"]');
    assert.equal(activeId(), 'z03', 'previous wraps across available entries');
    await click('button[aria-label="Next world"]');
    assert.equal(activeId(), 'z01');
    await act(async () => { client.setQueryData(worldListItemQueryKey(realmBaseUrl, 'z01'), null); }); await settle();
    assert.equal(activeId(), 'd10', 'a removed active World is replaced by an available entry');
    await act(async () => { for (const id of WORLD_ATLAS_LEAD_WORLD_IDS) client.setQueryData(worldListItemQueryKey(realmBaseUrl, id), null); }); await settle();
    assert.equal(activeId(), undefined);
    assert.ok(Array.from(dom.window.document.querySelectorAll('button')).some(button => button.textContent === 'Refresh'));
  } finally {
    await act(async () => { for (const read of reads.values()) read.reject(new Error('Test cleanup')); });
    await settle();
    await act(async () => { root.unmount(); }); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
