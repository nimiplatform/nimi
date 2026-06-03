import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const rendererRoot = resolve(import.meta.dirname, '../src/shell/renderer');
const notificationPanelSource = readFileSync(
  resolve(rendererRoot, 'features/notification/notification-panel.tsx'),
  'utf8',
);
const notificationActionButtonsSource = readFileSync(
  resolve(rendererRoot, 'features/notification/notification-action-buttons.tsx'),
  'utf8',
);
const notificationModelPath = resolve(rendererRoot, 'features/notification/notification-model.ts');

test('Desktop notification surface consumes SDK Realm notification projections', () => {
  assert.match(notificationPanelSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(notificationPanelSource, /from '@nimiplatform\/kit\/core\/notifications'/);
  assert.match(notificationPanelSource, /toRealmNotificationListProjection/);
  assert.match(notificationPanelSource, /getNimiNotificationCategory/);
  assert.match(notificationPanelSource, /getNimiNotificationServerFilter/);
  assert.match(notificationPanelSource, /getNimiNotificationBadgeKey/);
  assert.match(notificationActionButtonsSource, /isNimiGiftNotificationReviewable/);
  assert.doesNotMatch(notificationPanelSource, /getRealmNotificationCategory/);
  assert.doesNotMatch(notificationPanelSource, /getRealmNotificationServerFilter/);
  assert.doesNotMatch(notificationPanelSource, /getRealmNotificationBadgeKey/);
  assert.doesNotMatch(`${notificationPanelSource}\n${notificationActionButtonsSource}`, /isRealmGiftNotificationReviewable/);
  assert.equal(existsSync(notificationModelPath), false);
  assert.doesNotMatch(notificationPanelSource, /function toNotificationItemView/);
  assert.doesNotMatch(notificationPanelSource, /function toNotificationListView/);
  assert.doesNotMatch(notificationPanelSource, /const REQUEST_NOTIFICATION_TYPES/);
  assert.doesNotMatch(notificationPanelSource, /parseOptionalJsonObject/);
});
