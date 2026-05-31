import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const notificationPanelSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/notification/notification-panel.tsx'),
  'utf8',
);
const facadeActionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade-actions.ts'),
  'utf8',
);
const facadeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade.ts'),
  'utf8',
);

test('notification panel consumes SDK Realm notification helpers for list and read status', () => {
  assert.match(notificationPanelSource, /loadRealmNotifications/);
  assert.match(notificationPanelSource, /markRealmNotificationRead/);
  assert.match(notificationPanelSource, /markRealmNotificationsRead/);
  assert.match(notificationPanelSource, /loadRealmNotificationUnreadCount/);
  assert.match(notificationPanelSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(notificationPanelSource, /loadRealmNotifications\(\s*getPlatformClient\(\)\.realm/);
  assert.match(notificationPanelSource, /markRealmNotificationRead\(getPlatformClient\(\)\.realm,\s*notificationId\)/);
  assert.match(notificationPanelSource, /markRealmNotificationsRead\(\s*getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(
    notificationPanelSource,
    /dataSync\.(loadNotifications|markNotificationRead|markNotificationsRead)/,
  );
});

test('Desktop dataSync facade no longer exposes notification list/read status ownership', () => {
  assert.doesNotMatch(
    facadeActionsSource,
    /from '\.\/flows\/notification-flow'|loadNotifications: async|markNotificationRead: async|markNotificationsRead: async/,
  );
  assert.doesNotMatch(
    facadeSource,
    /loadNotifications\(options|markNotificationRead\(notificationId|markNotificationsRead\(payload/,
  );
});
