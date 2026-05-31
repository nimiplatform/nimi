import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '../src/realm/client.js';
import {
  loadRealmNotifications,
  loadRealmNotificationUnreadCount,
  markRealmNotificationRead,
  markRealmNotificationsRead,
  normalizeRealmNotificationUnreadCount,
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
