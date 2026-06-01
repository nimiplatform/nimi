import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '../src/realm/client.js';
import {
  loadRealmNotifications,
  loadRealmNotificationUnreadCount,
  markRealmNotificationRead,
  markRealmNotificationsRead,
  normalizeRealmNotificationUnreadCount,
  toRealmNotificationListProjection,
} from '../src/realm/extensions/notifications.js';

type FakeRealm = {
  services: {
    NotificationsService: {
      getUnreadCount: () => Promise<unknown>;
      listNotifications: (
        type?: string,
        unreadOnly?: boolean,
        limit?: number,
        cursor?: string,
      ) => Promise<unknown>;
      markNotificationsRead: (input: Record<string, unknown>) => Promise<void>;
      markNotificationRead: (notificationId: string) => Promise<void>;
    };
  };
};

function createFakeRealm(payload: unknown, capturedCalls: string[] = []): FakeRealm {
  return {
    services: {
      NotificationsService: {
        getUnreadCount: async () => payload,
        listNotifications: async (type, unreadOnly, limit, cursor) => {
          capturedCalls.push(`list:${type || ''}:${String(unreadOnly)}:${String(limit)}:${cursor || ''}`);
          return payload;
        },
        markNotificationsRead: async (input) => {
          const ids = Array.isArray(input.ids) ? input.ids.join(',') : '';
          capturedCalls.push(`mark-many:${ids}:${String(input.markAllBefore || '')}`);
        },
        markNotificationRead: async (notificationId) => {
          capturedCalls.push(`mark-one:${notificationId}`);
        },
      },
    },
  };
}

test('normalizeRealmNotificationUnreadCount projects total and per-type counts', () => {
  assert.deepEqual(
    normalizeRealmNotificationUnreadCount({
      total: 4,
      byType: {
        gift: 3,
        mention: 1,
      },
    }),
    {
      total: 4,
      byType: {
        gift: 3,
        mention: 1,
      },
    },
  );
});

test('normalizeRealmNotificationUnreadCount fails closed when total is missing or invalid', () => {
  assert.throws(
    () => normalizeRealmNotificationUnreadCount({ total: -1, byType: {} }),
    /REALM_NOTIFICATION_UNREAD_CONTRACT_INVALID/,
  );
  assert.throws(
    () => normalizeRealmNotificationUnreadCount({ byType: {} } as never),
    /REALM_NOTIFICATION_UNREAD_CONTRACT_INVALID/,
  );
});

test('loadRealmNotificationUnreadCount calls the Realm notification service', async () => {
  const result = await loadRealmNotificationUnreadCount(createFakeRealm({
    total: 2,
    byType: {
      system: 2,
    },
  }) as unknown as Realm);

  assert.deepEqual(result, {
    total: 2,
    byType: {
      system: 2,
    },
  });
});

test('loadRealmNotifications forwards list options to the Realm notification service', async () => {
  const capturedCalls: string[] = [];
  const result = await loadRealmNotifications(createFakeRealm({
    items: [{ id: 'notification-1' }],
    nextCursor: 'cursor-2',
  }, capturedCalls) as unknown as Realm, {
    type: 'system_announcement',
    unreadOnly: true,
    limit: 10,
    cursor: 'cursor-1',
  });

  assert.deepEqual(capturedCalls, [
    'list:system_announcement:true:10:cursor-1',
  ]);
  assert.deepEqual(result, {
    items: [{ id: 'notification-1' }],
    nextCursor: 'cursor-2',
  });
});

test('markRealmNotificationsRead and markRealmNotificationRead forward typed read requests', async () => {
  const capturedCalls: string[] = [];
  const realm = createFakeRealm({}, capturedCalls) as unknown as Realm;

  const markMany = await markRealmNotificationsRead(realm, {
    ids: ['notification-1', 'notification-2'],
  });
  const markOne = await markRealmNotificationRead(realm, ' notification-3 ');

  assert.deepEqual(capturedCalls, [
    'mark-many:notification-1,notification-2:',
    'mark-one:notification-3',
  ]);
  assert.deepEqual(markMany, { ok: true });
  assert.deepEqual(markOne, { id: 'notification-3' });
  await assert.rejects(
    () => markRealmNotificationRead(realm, ' '),
    /REALM_NOTIFICATION_ID_REQUIRED/,
  );
});

test('notification list projection normalizes actors, page cursors, and gift payload fields', () => {
  const result = toRealmNotificationListProjection({
    items: [
      {
        id: 'notif-request',
        type: 'friend_request_received',
        title: 'Someone sent you a friend request',
        body: null,
        createdAt: '2026-03-15T00:00:00.000Z',
        isRead: false,
        actor: null,
        target: null,
        data: null,
      },
      {
        id: 'notif-gift',
        type: 'gift_received',
        title: 'A gift arrived',
        body: 'For you',
        createdAt: '2026-03-15T00:00:00.000Z',
        isRead: false,
        actor: {
          id: 'user-9',
          displayName: 'Sender',
          handle: '@sender',
          avatarUrl: null,
          isAgent: false,
        },
        target: {
          interactionId: 'gift-tx-1',
        },
        data: {
          sparkCost: '88',
          message: 'Enjoy this one',
        },
      },
    ],
    page: {
      hasNext: true,
      nextCursor: 'cursor-2',
    },
  } as never, 'Notification', 'Unknown');

  assert.equal(result.items[0]?.actorName, 'Unknown');
  assert.equal(result.items[1]?.giftTransactionId, 'gift-tx-1');
  assert.equal(result.items[1]?.giftSparkCost, '88');
  assert.equal(result.items[1]?.giftMessage, 'Enjoy this one');
  assert.equal(result.nextCursor, 'cursor-2');
  assert.equal(result.hasNext, true);
});
