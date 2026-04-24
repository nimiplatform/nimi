import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  loadNotificationUnreadCount,
  loadNotifications,
  markNotificationRead,
  markNotificationsRead,
} from '../src/runtime/data-sync/flows/notification-flow.js';

const economyFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/flows/economy-notification-flow.ts'),
  'utf8',
);
const notificationFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/flows/notification-flow.ts'),
  'utf8',
);
const facadeActionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade-actions.ts'),
  'utf8',
);

test('notification data-sync flow behaviorally owns D-DSYNC-009 service calls', async () => {
  const capturedCalls: string[] = [];
  const callApi = async <T>(task: (realm: unknown) => Promise<T>): Promise<T> =>
    task({
      services: {
        NotificationsService: {
          getUnreadCount: async () => {
            capturedCalls.push('unread-count');
            return { count: 2 };
          },
          listNotifications: async (
            type?: string,
            unreadOnly?: boolean,
            limit?: number,
            cursor?: string,
          ) => {
            capturedCalls.push(`list:${type || ''}:${String(unreadOnly)}:${String(limit)}:${cursor || ''}`);
            return { items: [{ id: 'notification-1' }], nextCursor: 'cursor-2' };
          },
          markNotificationsRead: async (input: Record<string, unknown>) => {
            const ids = Array.isArray(input.ids) ? input.ids.join(',') : '';
            capturedCalls.push(`mark-many:${ids}`);
          },
          markNotificationRead: async (notificationId: string) => {
            capturedCalls.push(`mark-one:${notificationId}`);
          },
        },
      },
    });
  const emitDataSyncError = () => undefined;

  const unread = await loadNotificationUnreadCount(callApi as never, emitDataSyncError);
  const list = await loadNotifications(callApi as never, emitDataSyncError, {
    type: 'system_announcement' as never,
    unreadOnly: true,
    limit: 10,
    cursor: 'cursor-1',
  });
  const markMany = await markNotificationsRead(callApi as never, emitDataSyncError, {
    ids: ['notification-1', 'notification-2'],
  } as never);
  const markOne = await markNotificationRead(callApi as never, emitDataSyncError, 'notification-3');

  assert.deepEqual(capturedCalls, [
    'unread-count',
    'list:system_announcement:true:10:cursor-1',
    'mark-many:notification-1,notification-2',
    'mark-one:notification-3',
  ]);
  assert.equal((unread as { count?: number }).count, 2);
  assert.equal((list as { nextCursor?: string }).nextCursor, 'cursor-2');
  assert.deepEqual(markMany, { ok: true });
  assert.deepEqual(markOne, { id: 'notification-3' });
});

test('notification D-DSYNC-009 owner is split from economy flow', () => {
  assert.doesNotMatch(economyFlowSource, /NotificationsService/);
  assert.doesNotMatch(economyFlowSource, /NotificationDto/);
  assert.match(notificationFlowSource, /NotificationsService\.getUnreadCount/);
  assert.match(notificationFlowSource, /NotificationsService\.listNotifications/);
  assert.match(notificationFlowSource, /NotificationsService\.markNotificationsRead/);
  assert.match(notificationFlowSource, /NotificationsService\.markNotificationRead/);
});

test('facade actions route notification methods through notification-flow', () => {
  assert.match(
    facadeActionsSource,
    /from '\.\/flows\/notification-flow';/,
  );
  assert.doesNotMatch(
    facadeActionsSource,
    /loadNotificationUnreadCount,[\s\S]*from '\.\/flows\/economy-notification-flow';/,
  );
});
