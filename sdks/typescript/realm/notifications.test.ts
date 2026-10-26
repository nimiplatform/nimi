import assert from 'node:assert/strict';
import test from 'node:test';

import type { NotificationListResultDto } from '../core-generated/realm-typed-client';
import { ReasonCode } from '../types';

import {
  loadNimiRealmNotificationUnreadCount,
  loadNimiRealmNotifications,
  markNimiRealmNotificationRead,
  markNimiRealmNotificationsRead,
  normalizeNimiRealmNotificationUnreadCount,
  toNimiRealmNotificationListView,
  type NimiRealmNotificationApi,
} from './index';

const NOTIFICATION_LIST_FIXTURE = {
  items: [{
    id: 'notification-1',
    type: 'friend_request_received',
    title: 'Friend request',
    body: 'Ada sent you a friend request',
    createdAt: '2026-06-05T00:00:00.000Z',
    isRead: false,
    actor: {
      createdAt: '2026-06-01T00:00:00.000Z',
      id: 'user-1',
      displayName: 'Ada',
      handle: 'ada',
      avatarUrl: 'https://img.test/a.png',
    },
    target: { accountId: 'user-1' },
    data: { accountId: 'user-1' },
  }],
  page: { nextCursor: 'cursor-2' },
} satisfies NotificationListResultDto;

test('Realm notification helpers map to generated notification requests', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown }> = [];
  const realm: NimiRealmNotificationApi = {
    notifications: {
      async getUnreadCount(request) {
        calls.push({ method: 'getUnreadCount', request });
        return { total: 3, byType: { friend_request_received: 2 } };
      },
      async listNotifications(request) {
        calls.push({ method: 'listNotifications', request });
        return NOTIFICATION_LIST_FIXTURE;
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
  };

  assert.deepEqual(await loadNimiRealmNotificationUnreadCount(realm), {
    total: 3,
    byType: { friend_request_received: 2 },
  });
  const page = await loadNimiRealmNotifications(realm, {
    type: 'friend_request_received',
    unreadOnly: true,
    limit: 20,
    cursor: 'cursor-1',
  });
  const view = toNimiRealmNotificationListView(page, 'Notification', 'Unknown');
  assert.equal(view.items[0]?.actorName, 'Ada');
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
      type: 'friend_request_received',
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
  for (const malformed of [
    { total: -1, byType: {} },
    { total: 1.5, byType: {} },
    { total: 1, byType: { friend_request_received: -1 } },
    { total: 1, byType: { friend_request_received: '1' } },
  ]) {
    assert.throws(
      () => normalizeNimiRealmNotificationUnreadCount(
        malformed as unknown as Parameters<typeof normalizeNimiRealmNotificationUnreadCount>[0],
      ),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode
        === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
    );
  }
  assert.throws(
    () => toNimiRealmNotificationListView(undefined, 'Notification', 'Unknown'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
  );
  assert.throws(
    () => toNimiRealmNotificationListView(
      { items: null, page: {} } as unknown as NotificationListResultDto,
      'Notification',
      'Unknown',
    ),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
  );
  assert.throws(
    () => toNimiRealmNotificationListView(
      { items: [{ id: '', type: 'friend_request_received' }], page: {} } as unknown as NotificationListResultDto,
      'Notification',
      'Unknown',
    ),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
  );
  assert.throws(
    () => toNimiRealmNotificationListView(
      {
        ...NOTIFICATION_LIST_FIXTURE,
        items: [{ ...NOTIFICATION_LIST_FIXTURE.items[0], type: 'future_notification_type' }],
      } as unknown as NotificationListResultDto,
      'Notification',
      'Unknown',
    ),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode
      === ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
  );

  const realm: NimiRealmNotificationApi = {
    notifications: {
      async getUnreadCount() { return { total: 0, byType: {} }; },
      async listNotifications() { return { items: [], page: { nextCursor: null, hasNext: false } }; },
      async markNotificationRead() { return {}; },
      async markNotificationsRead() { return {}; },
    },
  };

  await assert.rejects(
    () => markNimiRealmNotificationRead(realm, ''),
    (error: unknown) => (error as { code?: string }).code === 'SDK_REALM_NOTIFICATION_ID_REQUIRED',
  );
});
