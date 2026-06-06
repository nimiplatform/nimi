import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const notificationPanelSource = readWorkspaceFile('src/shell/renderer/features/notification/notification-panel.tsx');
const notificationHelpersSource = readWorkspaceFile('src/shell/renderer/features/notification/notification-panel-helpers.ts');

test('notification panel unread count consumes SDK Realm projection, not Desktop dataSync parser', () => {
  assert.match(notificationPanelSource, /loadNimiRealmNotificationUnreadCount/);
  assert.match(notificationPanelSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(notificationPanelSource, /queryFn:\s*async \(\) => loadNimiRealmNotificationUnreadCount\(getDesktopRealm\(\)\)/);
  assert.match(notificationPanelSource, /optimisticUnreadCount \?\? unreadCountQuery\.data\?\.total \?\? 0/);
  assert.doesNotMatch(notificationPanelSource, /dataSync\.loadNotificationUnreadCount/);
  assert.doesNotMatch(notificationPanelSource, /parseUnreadCount/);
  assert.doesNotMatch(notificationPanelSource, /getPlatformClient\(\)\.realm/);
  assert.doesNotMatch(notificationHelpersSource, /UnreadNotificationCountDto|parseUnreadCount/);
});
