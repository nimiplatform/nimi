import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Back restores list position while live query changes preserve search focus', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { useHomeListPosition } = await import('../src/shell/renderer/app-shell/providers/use-home-list-position.js');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  const root = createRoot(dom.window.document.getElementById('root')!);
  function List({ query }: { query: string }) {
    const viewport = useHomeListPosition(query);
    return <><input aria-label="Search" /><div ref={viewport} data-testid="list"><button data-view-key="partner-a">Partner A</button></div></>;
  }
  const render = async (query: string | null) => act(async () => {
    root.render(<AppStoreProvider store={store}>{query === null ? null : <List query={query} />}</AppStoreProvider>);
  });
  try {
    await render('all');
    const list = dom.window.document.querySelector<HTMLElement>('[data-testid="list"]')!;
    const button = dom.window.document.querySelector('button')!;
    list.scrollTop = 180; button.focus();
    await render('filtered');
    const search = dom.window.document.querySelector('input')!;
    search.focus();
    await render('all');
    assert.equal(dom.window.document.activeElement, search, 'editing a query must not focus a cached row');
    assert.equal(list.scrollTop, 180);
    button.focus();
    await render(null);
    await render('all');
    assert.equal(dom.window.document.activeElement?.getAttribute('data-view-key'), 'partner-a');
    assert.equal(dom.window.document.querySelector<HTMLElement>('[data-testid="list"]')!.scrollTop, 180);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  }
});
