import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { useHomeRealmMessages } from '../src/shell/renderer/features/home/use-home-realm-messages.js';
import { filterCenterMessages, isPendingMessage, isUnreadMessage } from '../src/shell/renderer/features/home/home-messages-model.js';
import { resolveNotificationIdentityRef } from '../src/shell/renderer/features/notification/notification-query.js';

test('current requests survive missing notification pages; read only consumes matched notice IDs', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { createRoot } = await import('react-dom/client');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference() {} });
  store.getState().setAuthSession({ id: 'viewer', realmEnvironmentId: 'realm-a' });
  const notice = (id: string, relationshipId: string) => ({ id, type: 'friend_request_received', title: 'Friend request', body: null,
    createdAt: '2026-11-01T00:00:00Z', isRead: false,
    actor: { id: 'eric', displayName: 'Eric', handle: 'eric', createdAt: '2026-10-01T00:00:00Z' },
    target: { accountId: 'eric' }, data: { relationshipId } });
  const readIds: string[][] = [];
  let firstPageCursor: string | null = null;
  const realm = { notifications: {
    listNotifications: async ({ query }: { query: { cursor?: string } }) => query.cursor
      ? { items: [notice('current-notice', 'current-request')], page: { hasNext: false, nextCursor: null } }
      : { items: [notice('old-notice', 'old-request')], page: { hasNext: true, nextCursor: firstPageCursor } },
    markNotificationsRead: async ({ body }: { body: { ids: string[] } }) => { readIds.push(body.ids); return {}; },
  }, generated: {
    getMyPendingFriendRequests: async () => ({ items: [{ userId: 'eric', relationshipId: 'current-request', displayName: 'Eric', handle: 'eric',
      avatarUrl: null, isDeleted: false, requestedAt: '2026-10-31T23:00:00Z' }], nextCursor: null, total: 1 }),
  } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let current!: ReturnType<typeof useHomeRealmMessages>;
  function Probe() { current = useHomeRealmMessages(); return null; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AppStoreProvider store={store}>
      <DesktopRendererBindingProvider bindings={{ sdk: { realm: () => realm } } as never}><Probe /></DesktopRendererBindingProvider>
    </AppStoreProvider></QueryClientProvider>));
    await settle();
    assert.equal(current.notifications.failed, true);
    assert.equal(current.notifications.complete, false, 'a missing continuation is a source failure, not a terminal page');
    assert.equal(current.requests.complete, true);
    assert.equal(current.messages.filter(message => message.request).length, 1);
    firstPageCursor = 'older';
    await act(async () => current.notifications.retry()); await settle();
    assert.equal(current.notifications.failed, false);
    assert.equal(current.notifications.complete, false);
    const pending = filterCenterMessages(current.messages, 'pending', 'realm');
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.time, '2026-10-31T23:00:00Z');
    assert.equal(current.messages.find(message => message.notifications[0]?.id === 'old-notice')?.request, null);
    await act(async () => current.notifications.loadMore()); await settle();
    assert.equal(current.messages.length, 2, 'the matched current request and notification are one item; the old event remains distinct');
    const request = current.messages.find(message => message.request)!;
    assert.deepEqual(request.notifications.map(item => item.id), ['current-notice']);
    await act(async () => current.markRead(request)); await settle();
    assert.deepEqual(readIds, [['current-notice']]);
    assert.equal(isPendingMessage(current.messages.find(message => message.request)!), true);
    assert.equal(isUnreadMessage(current.messages.find(message => message.request)!), false);
    assert.equal(isUnreadMessage(current.messages.find(message => !message.request)!), true);
    current.open(current.messages.find(message => message.request)!);
    assert.equal(store.navigation.getSnapshot().current.destination.chat?.contactsSection, 'received');
    assert.notEqual(resolveNotificationIdentityRef('authenticated', { id: 'viewer', realmEnvironmentId: 'realm-a' }),
      resolveNotificationIdentityRef('authenticated', { id: 'viewer', realmEnvironmentId: 'realm-b' }));
  } finally {
    await act(async () => root.unmount()); client.clear(); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
