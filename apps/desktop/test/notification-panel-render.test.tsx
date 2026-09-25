import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationPanelHeader } from '../src/shell/renderer/features/notification/notification-panel-header.js';
import { notificationQueryKeys } from '../src/shell/renderer/features/notification/notification-query.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { RealmSocialDataProvider } from '../src/shell/renderer/features/social/data/realm-social-data-context.js';
import type { RealmSocialData } from '../src/shell/renderer/features/social/data/realm-social-data.js';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context.js';
import { initI18n, changeLocale, productionDesktopI18n } from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

test('notification header only claims all caught up after observing zero unread', async () => {
  await initI18n();
  await changeLocale('en');
  const render = (unreadCount: number | null) => renderToStaticMarkup(
    <NotificationPanelHeader activeFilter="all" unreadCount={unreadCount}
      onFilterChange={() => undefined} onMarkAllRead={() => undefined} />,
  );
  assert.doesNotMatch(render(null), /caught up|\d+ unread/u);
  assert.match(render(0), /caught up/u);
  assert.match(render(3), /3 unread/u);
});

test('notification header hides mark all read unless unread notifications exist', async () => {
  await initI18n();
  await changeLocale('en');
  const render = (unreadCount: number | null) => renderToStaticMarkup(
    <NotificationPanelHeader activeFilter="all" unreadCount={unreadCount}
      onFilterChange={() => undefined} onMarkAllRead={() => undefined} />,
  );
  assert.doesNotMatch(render(null), /Mark All Read/u);
  assert.doesNotMatch(render(0), /Mark All Read/u);
  assert.match(render(3), /Mark All Read/u);
});

test('request filter retains pagination when only later pages contain requests', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { NotificationPanel } = await import('../src/shell/renderer/features/notification/notification-panel.js');
  await initI18n();
  await changeLocale('en');
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  store.getState().setAuthSession({ id: 'pagination-user' });
  const item = (id: string, type: string) => ({
    id, type, title: id, body: null, createdAt: '2026-09-18T00:00:00Z', isRead: true,
    actor: null, target: null, data: null,
  });
  client.setQueryData(notificationQueryKeys.page('user:pagination-user', null), {
    pages: [{ items: [item('like-on-first-page', 'post_liked')], page: { nextCursor: 'older-page' } }], pageParams: [''],
  });
  client.setQueryData(notificationQueryKeys.topbarUnreadCount('user:pagination-user'), { total: 0, byType: {} });
  const cursors: string[] = [];
  // Unit fixture at the SDK transport boundary; this does not exercise a live Realm.
  const bindings = { sdk: { realm: () => ({ notifications: {
    listNotifications: async ({ query }: { query: { cursor: string } }) => {
      cursors.push(query.cursor);
      return { items: [item('request-on-second-page', 'friend_request_received')], page: { nextCursor: null } };
    },
  } }) } } as unknown as DesktopCanonicalRendererBindings;
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <AppStoreProvider store={store}>
          <DesktopRendererBindingProvider bindings={bindings}>
            <DesktopI18nResourceProvider resource={productionDesktopI18n}>
              <RealmSocialDataProvider resource={{} as RealmSocialData}><NotificationPanel /></RealmSocialDataProvider>
            </DesktopI18nResourceProvider>
          </DesktopRendererBindingProvider>
        </AppStoreProvider>
      </QueryClientProvider>,
    ));
    const findButton = (label: string) => [...dom.window.document.querySelectorAll('button')].find((button) => button.textContent === label);
    const requests = findButton('Requests');
    assert.ok(requests);
    await act(async () => requests.click());
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /like-on-first-page/u);
    const more = findButton('Load More');
    assert.ok(more, 'a locally empty filter must not hide the remaining pages');
    await act(async () => {
      more.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.deepEqual(cursors, ['older-page']);
    assert.match(dom.window.document.body.textContent ?? '', /request-on-second-page/u);
    assert.equal(findButton('Load More'), undefined);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
