import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const rendererRoot = resolve(import.meta.dirname, '../src/shell/renderer');
const notificationPanelSource = readFileSync(
  resolve(rendererRoot, 'features/notification/notification-panel.tsx'),
  'utf8',
);
const notificationPanelItemCardSource = readFileSync(
  resolve(rendererRoot, 'features/notification/notification-panel-item-card.tsx'),
  'utf8',
);
const notificationActionButtonsSource = readFileSync(
  resolve(rendererRoot, 'features/notification/notification-action-buttons.tsx'),
  'utf8',
);
const notificationModelPath = resolve(rendererRoot, 'features/notification/notification-model.ts');

test('Desktop notification surface consumes SDK Realm notification projections', () => {
  const notificationSurfaceSource = `${notificationPanelSource}\n${notificationPanelItemCardSource}`;
  assert.match(notificationPanelSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(notificationSurfaceSource, /from '@nimiplatform\/kit\/core\/notifications'/);
  assert.match(notificationPanelSource, /toRealmNotificationListProjection/);
  assert.match(notificationPanelSource, /getNimiNotificationCategory/);
  assert.match(notificationPanelSource, /getNimiNotificationServerFilter/);
  assert.match(notificationSurfaceSource, /getNimiNotificationBadgeKey/);
  assert.match(notificationActionButtonsSource, /isNimiGiftNotificationReviewable/);
  assert.doesNotMatch(notificationSurfaceSource, /getRealmNotificationCategory/);
  assert.doesNotMatch(notificationSurfaceSource, /getRealmNotificationServerFilter/);
  assert.doesNotMatch(notificationSurfaceSource, /getRealmNotificationBadgeKey/);
  assert.doesNotMatch(`${notificationSurfaceSource}\n${notificationActionButtonsSource}`, /isRealmGiftNotificationReviewable/);
  assert.equal(existsSync(notificationModelPath), false);
  assert.doesNotMatch(notificationSurfaceSource, /function toNotificationItemView/);
  assert.doesNotMatch(notificationSurfaceSource, /function toNotificationListView/);
  assert.doesNotMatch(notificationSurfaceSource, /const REQUEST_NOTIFICATION_TYPES/);
  assert.doesNotMatch(notificationSurfaceSource, /parseOptionalJsonObject/);
});
