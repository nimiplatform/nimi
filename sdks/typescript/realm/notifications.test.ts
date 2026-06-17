import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadNimiRealmNotificationUnreadCount,
  loadNimiRealmNotifications,
  markNimiRealmNotificationRead,
  markNimiRealmNotificationsRead,
  normalizeNimiRealmNotificationUnreadCount,
  toNimiRealmNotificationListView,
  type NimiRealmNotificationApi,
} from './index';

test('Realm notification helpers map to generated notification requests', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm = {
    notifications: {
      async getUnreadCount(request) {
        calls.push({ method: 'getUnreadCount', request });
        return { total: 3, byType: { gift_received: 2, broken: -1 } };
      },
      async listNotifications(request) {
        calls.push({ method: 'listNotifications', request });
        return {
          items: [{
            id: 'notification-1',
            type: 'gift_received',
            title: 'Gift',
            body: 'Received',
            createdAt: '2026-06-05T00:00:00.000Z',
            isRead: false,
            actor: { id: 'user-1', displayName: 'Ada', avatarUrl: 'https://img.test/a.png' },
            target: { interactionId: 'gift-1' },
            data: { status: 'pending', message: 'hello', sparkCost: 10 },
          }],
          page: { nextCursor: 'cursor-2' },
        };
      },
      async markNotificationRead(request) {
        calls.push({ method: 'markNotificationRead', request });
        return {};
      },
      async markNotificationsRead(request) {
        calls.push({ method: 'markNotificationsRead', request });
        return {};
      },
    },
  } as unknown as NimiRealmNotificationApi;

  assert.deepEqual(await loadNimiRealmNotificationUnreadCount(realm), {
    total: 3,
    byType: { gift_received: 2 },
  });
  const page = await loadNimiRealmNotifications(realm, {
    type: 'gift_received',
    unreadOnly: true,
    limit: 20,
    cursor: 'cursor-1',
  });
  const view = toNimiRealmNotificationListView(page, 'Notification', 'Unknown');
  assert.equal(view.items[0]?.actorName, 'Ada');
  assert.equal(view.items[0]?.giftTransactionId, 'gift-1');
  assert.equal(view.nextCursor, 'cursor-2');
  assert.deepEqual(await markNimiRealmNotificationRead(realm, ' notification-1 '), { id: 'notification-1' });
  assert.deepEqual(await markNimiRealmNotificationsRead(realm, { ids: ['notification-1'] }), { ok: true });

  assert.deepEqual(calls.map((call) => call.method), [
    'getUnreadCount',
    'listNotifications',
    'markNotificationRead',
    'markNotificationsRead',
  ]);
  assert.deepEqual(calls[1]?.request, {
    path: {},
    query: {
      type: 'gift_received',
      unreadOnly: true,
      limit: 20,
      cursor: 'cursor-1',
    },
  });
  assert.deepEqual(calls[2]?.request, {
    path: { notificationId: 'notification-1' },
  });
});

test('Realm notification views fail closed on invalid required values', async () => {
  assert.throws(
    () => normalizeNimiRealmNotificationUnreadCount({ total: -1, byType: {} }),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_NOTIFICATION_UNREAD_CONTRACT_INVALID',
  );

  const realm = {
    notifications: {
      async getUnreadCount() { return { total: 0, byType: {} }; },
      async listNotifications() { return { items: [], page: {} }; },
      async markNotificationRead() { return {}; },
      async markNotificationsRead() { return {}; },
    },
  } as unknown as NimiRealmNotificationApi;

  await assert.rejects(
    () => markNimiRealmNotificationRead(realm, ''),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_NOTIFICATION_ID_REQUIRED',
  );
});
