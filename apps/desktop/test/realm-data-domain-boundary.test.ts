import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const rendererRoot = resolve(import.meta.dirname, '../src/shell/renderer');

function readRenderer(relativePath: string): string {
  return readFileSync(resolve(rendererRoot, relativePath), 'utf8');
}

test('Realm Data domain surfaces consume SDK or Kit projections instead of app-owned service facades', () => {
  const groupDataSource = readRenderer('features/chat/data/realm-group-chat-data.ts');
  const notificationPanelSource = readRenderer('features/notification/notification-panel.tsx');
  const humanComposerSource = readRenderer('features/chat/chat-human-canonical-composer-profile.tsx');
  const humanComponentsSource = readRenderer('features/chat/chat-human-canonical-components.tsx');
  const messageTimelineSource = readRenderer('features/turns/message-timeline-utils.tsx');
  const notificationQuerySource = readRenderer('features/notification/notification-query.ts');
  const preferencesSource = readRenderer('features/settings/settings-preferences-panel.tsx');
  const privacySource = readRenderer('features/settings/settings-privacy-page.tsx');

  assert.match(groupDataSource, /listRealmGroupChats/);
  assert.match(groupDataSource, /commitRealmGroupMessageCandidate/);
  assert.doesNotMatch(groupDataSource, /GroupChatsService\./);

  assert.match(notificationPanelSource, /toRealmNotificationListProjection/);
  assert.match(notificationPanelSource, /getRealmNotificationCategory/);
  assert.doesNotMatch(notificationPanelSource, /NotificationsService\./);
  assert.doesNotMatch(notificationPanelSource, /function toNotificationListView/);

  for (const source of [humanComposerSource, humanComponentsSource, messageTimelineSource]) {
    assert.match(source, /@nimiplatform\/kit\/features\/chat\/realm/);
    assert.doesNotMatch(source, /chat-attachment-contract/);
    assert.doesNotMatch(source, /HumanChatsService\./);
    assert.doesNotMatch(source, /ResourcesService\./);
  }

  assert.match(preferencesSource, /loadRealmUserNotificationSettings/);
  assert.match(preferencesSource, /updateRealmUserNotificationSettings/);
  assert.match(privacySource, /loadRealmUserSettings/);
  assert.match(privacySource, /updateRealmUserSettings/);
  for (const source of [notificationQuerySource, preferencesSource, privacySource]) {
    assert.doesNotMatch(source, /dataSync\./);
  }
});
