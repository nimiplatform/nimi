import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { WorldListItem } from '../src/shell/renderer/features/world/world-list-model.js';
import type { RealmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data.js';

// Deferred reads exercise real Query/React behavior; this is regression coverage,
// not a substitute for acceptance against the running Home and Realm.
test('opening cards fill their final positions and the spotlight reveals its settled prefix', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const coverVisibility = new Map<Element, (visible: boolean) => void>();
  class Observer {
    constructor(readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      coverVisibility.set(target, isIntersecting => this.callback(
        [{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver,
      ));
    }
    disconnect() {}
    unobserve(target: Element) { coverVisibility.delete(target); }
  }
  Object.defineProperty(dom.window.HTMLImageElement.prototype, 'clientWidth', { get: () => 320 });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    ResizeObserver: class { observe() {} disconnect() {} },
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IntersectionObserver: Observer, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClientProvider } = await import('@tanstack/react-query');
  const { createDesktopQueryClient } = await import('../src/shell/renderer/infra/query-client/query-client.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { useWorldAtlasLeadWorlds } = await import('../src/shell/renderer/features/world/world-atlas-data.js');
  const { useWorldSummaryBatches, worldSummaryBatches } = await import('../src/shell/renderer/features/world/use-world-summary-batches.js');
  const { WorldCatalogContent } = await import('../src/shell/renderer/features/world/world-list.js');
  const { WORLD_ATLAS_LEAD_WORLD_IDS, WORLD_DISCOVERY_OPENING_IDS } = await import('../src/shell/renderer/features/world/world-list-catalog-model.js');
  await initI18n(); await changeLocale('en');
  const reads: string[][] = [];
  let resolve!: (rows: unknown[]) => void;
  const data = { loadWorldSummaries: (ids: string[]) => {
    reads.push(ids);
    return new Promise(done => { resolve = done; });
  } } as unknown as RealmWorldData;
  const client = createDesktopQueryClient();
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const realmBaseUrl = 'https://realm.test';
  function Harness() {
    const spotlight = useWorldAtlasLeadWorlds({ data, realmBaseUrl, enabled: true, offline: false }, false);
    return <WorldCatalogContent worlds={[]} loading leadWorlds={spotlight.worlds} pendingLeadIds={spotlight.pendingIds}
      spotlightLoading={spotlight.loading} spotlightError={spotlight.error} onRetrySpotlight={spotlight.retry}
      paging={{ totalCount: 0, hasMore: false, loadingMore: false, loadMoreFailed: false, offlineIncomplete: false, onLoadMore() {} }} />;
  }
  function OfflineSelection() {
    const selected = useWorldSummaryBatches({ data, realmBaseUrl, enabled: true, offline: true },
      worldSummaryBatches(['newly-saved', WORLD_DISCOVERY_OPENING_IDS[1]]));
    return <span data-testid="offline-selection">{selected.worlds.map(world => world.name).join(',')}</span>;
  }
  const settle = async () => {
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const media: NonNullable<WorldListItem['bannerMedia']> = {
    resourceId: 'resource-cover', contentVersion: 'a'.repeat(64), publicationGeneration: 1, policyVersion: 'policy-v1',
    expiresAt: null, previewUrl: null, originalUrl: null, video: null,
    images: ['card', 'hero'].map((purpose) => ({
      purpose: purpose as 'card' | 'hero',
      families: [{ mimeType: 'image/png', sources: [{ url: `https://example.com/${purpose}-640.png`, width: 640, height: purpose === 'card' ? 264 : 427, mimeType: 'image/png' }] }],
    })),
  };
  const openingSampleId = WORLD_DISCOVERY_OPENING_IDS[1];
  const skippedLeadId = WORLD_ATLAS_LEAD_WORLD_IDS[3];
  const row = (id: string) => ({ id, name: id, summary: id, type: 'CREATOR', media: {}, stats: {}, time: { mode: 'static' },
    bannerUrl: `https://example.com/${id}.png`, ...(id === openingSampleId ? { bannerMedia: media } : {}) });
  const activeId = () => dom.window.document.querySelector('.world-atlas-hero[data-world-id]')?.getAttribute('data-world-id');
  const click = async (selector: string) => {
    await act(async () => { dom.window.document.querySelector<HTMLButtonElement>(selector)!.click(); });
  };
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}><Harness /></AppStoreProvider></QueryClientProvider>); });
    assert.deepEqual(reads, [[...WORLD_DISCOVERY_OPENING_IDS, ...WORLD_ATLAS_LEAD_WORLD_IDS]]);
    assert.equal(activeId(), undefined);
    const slots = () => [...dom.window.document.querySelectorAll('.world-discovery-grid > *')].map(
      card => card.querySelector('h3')?.textContent ?? null,
    );
    assert.deepEqual(slots(), Array(WORLD_DISCOVERY_OPENING_IDS.length).fill(null));
    await act(async () => resolve([openingSampleId, ...WORLD_ATLAS_LEAD_WORLD_IDS.filter(id => id !== skippedLeadId)].map(row)));
    await settle();
    assert.deepEqual(slots(), [openingSampleId]);
    const cover = dom.window.document.querySelector('.world-discovery-card .world-atlas-image')!;
    await act(async () => coverVisibility.get(cover)!(false));
    assert.equal(cover.querySelector('img'), null, 'offscreen discovery covers wait for admission');
    Object.defineProperty(cover, 'getBoundingClientRect', {value: () => ({ top: 10, bottom: 200 })});
    Object.defineProperty(cover.closest('.world-atlas-viewport')!, 'getBoundingClientRect', {value: () => ({top:0,bottom:600})});
    await act(async () => coverVisibility.get(cover)!(true));
    const image = cover.querySelector('img')!;
    assert.equal(image.getAttribute('src'), 'https://example.com/hero-640.png', 'the grid keeps the taller hero rendition');
    assert.equal(image.getAttribute('width'), '640');
    assert.equal(image.getAttribute('height'), '427');
    await act(async () => coverVisibility.get(cover)!(false));
    assert.equal(image.getAttribute('fetchpriority'), 'low');
    await act(async () => coverVisibility.get(cover)!(true));
    assert.equal(cover.querySelector('img'), image);
    assert.equal(image.getAttribute('fetchpriority'), 'high');
    assert.equal(activeId(), WORLD_ATLAS_LEAD_WORLD_IDS[0]);
    await click('button[aria-label="Next world"]');
    assert.equal(activeId(), WORLD_ATLAS_LEAD_WORLD_IDS[1]);
    await click('button[aria-label="Previous world"]');
    assert.equal(activeId(), WORLD_ATLAS_LEAD_WORLD_IDS[0]);
    assert.equal(dom.window.document.querySelectorAll('.world-atlas-hero-dots button').length, 4);
    await click('button[aria-label="Previous world"]');
    assert.equal(activeId(), WORLD_ATLAS_LEAD_WORLD_IDS[4], 'previous wraps across available entries');
    await click('button[aria-label="Next world"]');
    assert.equal(activeId(), WORLD_ATLAS_LEAD_WORLD_IDS[0]);
    await act(async () => root.render(<QueryClientProvider client={client}><OfflineSelection /></QueryClientProvider>));
    assert.equal(dom.window.document.querySelector('[data-testid="offline-selection"]')?.textContent, openingSampleId);
    assert.equal(reads.length, 1, 'offline edits to the selection reuse accepted summaries without another read');
    assert.deepEqual(worldSummaryBatches(Array.from({ length: 201 }, (_, i) => String(i))).map(b => b.length), [40, 40, 40, 40, 40, 1]);
  } finally {
    await act(async () => { root.unmount(); }); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
