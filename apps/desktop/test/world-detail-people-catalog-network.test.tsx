import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

// Real TanStack Query state rather than a hand-built catalog. While offline a first page is paused
// (fetchStatus 'paused', isPending true, no error): it must read as offline instead of loading
// forever, and load by itself once the connection returns.

type Page = { items: unknown[]; nextCursor: string | null; hasMore: boolean; totalCount: number };
type Request = { cursor?: string | null };
type Source = {
  loadWorldCharacterPage: (worldId: string, request: Request) => Promise<Page>;
  loadPersonaCharacterCatalogPage: (request: Request) => Promise<Page>;
};

function summary(id: string, name: string) {
  return {
    id,
    name,
    sourceRef: {
      kind: 'worldCharacter',
      id,
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: `entity-${id}` },
      sourceHash: 'a'.repeat(64),
    },
  };
}

function page(items: unknown[], nextCursor: string | null, totalCount: number): Page {
  return { items, nextCursor, hasMore: nextCursor !== null, totalCount };
}

async function mountCatalog(source: Source, networkOffline: boolean) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider, onlineManager } = await import('@tanstack/react-query');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
  const { useWorldPeopleCatalog } = await import('../src/shell/renderer/features/world/world-detail-people-catalog.js');
  const { PeopleCatalogFirstPageStatus, PeopleCatalogMoreControl } = await import('../src/shell/renderer/features/world/world-detail-people-catalog-status.js');
  await initI18n();
  await changeLocale('en');

  function Harness() {
    const { peopleCharacters, peopleCatalog } = useWorldPeopleCatalog({
      worldId: 'world-1',
      worldCreatedAt: '2026-01-01T00:00:00.000Z',
      realmBaseUrl: 'http://realm.test',
      query: '',
      queryText: '',
      onQueryChange: () => {},
      enabled: true,
      networkOffline,
      source: source as never,
    });
    return (
      <div>
        <output data-testid="status">{peopleCatalog.status}</output>
        <output data-testid="offline">{String(peopleCatalog.offline)}</output>
        <output data-testid="people">{peopleCharacters.map((character) => character.name).join(',')}</output>
        <PeopleCatalogFirstPageStatus catalog={peopleCatalog} />
        <PeopleCatalogMoreControl catalog={peopleCatalog} loadedCount={peopleCharacters.length} />
      </div>
    );
  }

  const root = createRoot(dom.window.document.getElementById('root')!);
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const settle = async () => {
    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
  };
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  });
  await settle();
  return {
    onlineManager,
    settle,
    text: () => dom.window.document.body.textContent ?? '',
    value: (testId: string) => dom.window.document.querySelector(`[data-testid="${testId}"]`)?.textContent,
    button: (label: RegExp) => [...dom.window.document.querySelectorAll('button')]
      .find((element) => label.test(element.textContent ?? '')) as HTMLButtonElement | undefined,
    cleanup: async () => {
      await act(async () => { root.unmount(); });
      client.clear();
      onlineManager.setOnline(true);
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

test('a paused people catalog reads as offline and loads its pages once the connection returns', async () => {
  const characterCursors: Array<string | null | undefined> = [];
  const source: Source = {
    loadWorldCharacterPage: async (_worldId, request) => {
      characterCursors.push(request.cursor);
      return request.cursor === 'cursor-2'
        ? page([summary('c2', 'Second Person')], null, 2)
        : page([summary('c1', 'First Person')], 'cursor-2', 2);
    },
    loadPersonaCharacterCatalogPage: async () => page([], null, 0),
  };
  const { onlineManager } = await import('@tanstack/react-query');
  onlineManager.setOnline(false);
  const view = await mountCatalog(source, false);
  try {
    assert.equal(view.value('status'), 'offline', 'a paused first page is not loading');
    assert.equal(view.value('offline'), 'true');
    assert.match(view.text(), /You're offline\. This World's people will load when you're back online\./);
    assert.doesNotMatch(view.text(), /Loading people…|Try again/);
    assert.deepEqual(characterCursors, [], 'nothing is requested while offline');

    await act(async () => { view.onlineManager.setOnline(true); });
    await view.settle();
    assert.equal(view.value('status'), 'ready');
    assert.equal(view.value('offline'), 'false');
    assert.equal(view.value('people'), 'First Person');
    assert.deepEqual(characterCursors, [null]);

    view.onlineManager.setOnline(false);
    const loadMore = view.button(/Load more people/);
    assert.ok(loadMore, 'the catalog offers its next page');
    await act(async () => { loadMore.click(); });
    await view.settle();
    assert.match(view.text(), /You're offline\. More people will load when you're back online\./);
    assert.equal(view.button(/Load more people/)?.disabled, true, 'a waiting page cannot be requested again');
    assert.equal(view.value('people'), 'First Person', 'loaded people stay');
    assert.deepEqual(characterCursors, [null], 'the next page waits for the connection');

    await act(async () => { view.onlineManager.setOnline(true); });
    await view.settle();
    assert.equal(view.value('people'), 'First Person,Second Person');
    assert.deepEqual(characterCursors, [null, 'cursor-2']);
    assert.equal(view.button(/Load more people/), undefined, 'the catalog ends only when Realm has no more');
  } finally {
    await view.cleanup();
  }
});

test('with the Desktop reporting Realm unreachable a failed first page asks for a retry', async () => {
  let realmReachable = false;
  const source: Source = {
    loadWorldCharacterPage: async () => {
      if (!realmReachable) throw Object.assign(new Error('Realm is unavailable'), { reasonCode: 'REALM_UNAVAILABLE' });
      return page([summary('c1', 'First Person')], null, 1);
    },
    loadPersonaCharacterCatalogPage: async () => page([], null, 0),
  };
  const view = await mountCatalog(source, true);
  try {
    assert.equal(view.value('status'), 'error', 'a failed first page is never an empty World');
    assert.equal(view.value('offline'), 'true');
    assert.match(view.text(), /Couldn't connect to load this World's people\. Check your connection and try again\./);
    const retry = view.button(/Try again/);
    assert.ok(retry, 'a retry is offered');

    realmReachable = true;
    await act(async () => { retry.click(); });
    await view.settle();
    assert.equal(view.value('status'), 'ready');
    assert.equal(view.value('people'), 'First Person');
  } finally {
    await view.cleanup();
  }
});
