import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

type Page = { items: string[]; nextCursor: string | null; hasMore: boolean; totalCount: number };

async function mountCatalog(loadPage: (cursor: string | null) => Promise<Page>, online: boolean) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider, onlineManager } = await import('@tanstack/react-query');
  const { useExploreCatalogQuery } = await import('../src/shell/renderer/features/explore/explore-catalog-query.js');
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  onlineManager.setOnline(online);
  let selectQuery: (value: string) => void = () => {};
  function Harness() {
    const [term, setTerm] = React.useState('original');
    selectQuery = setTerm;
    const state = useExploreCatalogQuery({ queryKey: ['test-catalog', term], loadPage, enabled: true, networkOffline: false });
    return <>
      <output id="loading">{String(state.initialLoading)}</output>
      <output id="unavailable">{String(state.initialUnavailable)}</output>
      <output id="offline">{String(state.offline)}</output>
      <output id="failedMore">{String(state.query.isFetchNextPageError)}</output>
      <output id="items">{state.query.data?.pages.flatMap((page) => page.items).join(',')}</output>
      <button onClick={() => void state.query.fetchNextPage()}>More</button>
    </>;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = async () => {
    for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  await act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  await settle();
  return {
    value: (id: string) => dom.window.document.getElementById(id)?.textContent,
    more: async () => { await act(async () => { dom.window.document.querySelector('button')!.click(); }); await settle(); },
    online: async (value: boolean) => { await act(async () => { onlineManager.setOnline(value); }); await settle(); },
    search: async (value: string) => { await act(async () => { selectQuery(value); }); await settle(); },
    cleanup: async () => {
      await act(async () => { root.unmount(); });
      client.clear(); onlineManager.setOnline(true); dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

const page = (items: string[], nextCursor: string | null): Page => ({ items, nextCursor, hasMore: nextCursor !== null, totalCount: 2 });

test('Explore catalogs expose paused reads as offline and do not reuse another search result', async () => {
  const calls: (string | null)[] = [];
  const view = await mountCatalog(async (cursor) => { calls.push(cursor); return cursor ? page(['second'], null) : page(['first'], 'next'); }, false);
  try {
    assert.equal(view.value('loading'), 'false');
    assert.equal(view.value('unavailable'), 'true');
    assert.equal(view.value('offline'), 'true');
    assert.equal(calls.length, 0);
    await view.online(true);
    assert.equal(view.value('items'), 'first');
    await view.online(false);
    await view.more();
    assert.equal(view.value('items'), 'first');
    assert.equal(view.value('unavailable'), 'false');
    assert.equal(view.value('offline'), 'true');
    assert.equal(calls.length, 1);
    await view.online(true);
    assert.equal(view.value('items'), 'first,second');
    await view.online(false);
    await view.search('different');
    assert.equal(view.value('items'), '');
    assert.equal(view.value('unavailable'), 'true');
    assert.equal(view.value('loading'), 'false');
    assert.deepEqual(calls, [null, 'next']);
  } finally { await view.cleanup(); }
});

test('a later page failure leaves the accepted catalog visible and retryable', async () => {
  let failNext = true;
  const calls: (string | null)[] = [];
  const view = await mountCatalog(async (cursor) => {
    calls.push(cursor);
    if (cursor && failNext) throw new Error('next page unavailable');
    return cursor ? page(['second'], null) : page(['first'], 'next');
  }, true);
  try {
    await view.more();
    assert.equal(view.value('items'), 'first');
    assert.equal(view.value('unavailable'), 'false');
    assert.equal(view.value('failedMore'), 'true');
    failNext = false;
    await view.more();
    assert.equal(view.value('items'), 'first,second');
    assert.equal(view.value('failedMore'), 'false');
    assert.deepEqual(calls, [null, 'next', 'next']);
  } finally { await view.cleanup(); }
});

test('world detail caches isolate the same World id across Realm targets', async () => {
  const { QueryClient } = await import('@tanstack/react-query');
  const keys = await import('../src/shell/renderer/features/world/world-detail-queries.js');
  const client = new QueryClient();
  try {
    for (const key of [keys.worldDisplayDetailQueryKey, keys.worldPrimaryDisplayDetailQueryKey, keys.worldSupplementalDisplayDetailQueryKey]) {
      client.setQueryData(key('https://realm-a.test', 'same-world'), { title: 'World from A' });
      assert.equal(client.getQueryData(key('https://realm-b.test', 'same-world')), undefined);
      assert.equal(client.getQueryData(key('https://realm-a.test', 'another-world')), undefined);
      assert.deepEqual(client.getQueryData(key('https://realm-a.test', 'same-world')), { title: 'World from A' });
    }
  } finally { client.clear(); }
});
