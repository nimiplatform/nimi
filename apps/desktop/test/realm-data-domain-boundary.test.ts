import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const rendererRoot = resolve(import.meta.dirname, '../src/shell/renderer');
const repoRoot = resolve(import.meta.dirname, '../../..');

function readRenderer(relativePath: string): string {
  return readFileSync(resolve(rendererRoot, relativePath), 'utf8');
}

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function readTree(relativePath: string): string {
  const root = resolve(repoRoot, relativePath);
  const chunks: string[] = [];
  const visit = (path: string) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        visit(resolve(path, entry));
      }
      return;
    }
    if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      chunks.push(readFileSync(path, 'utf8'));
    }
  };
  visit(root);
  return chunks.join('\n');
}

test('Realm Data domain surfaces consume SDK or Kit projections instead of app-owned service facades', () => {
  const groupDataSource = readRenderer('features/chat/data/realm-group-chat-data.ts');
  const notificationPanelSource = readRenderer('features/notification/notification-panel.tsx');
  const humanComposerSource = readRenderer('features/chat/chat-human-canonical-composer-profile.tsx');
  const humanComponentsSource = readRenderer('features/chat/chat-human-canonical-components.tsx');
  const humanTimelineModelSource = readRenderer('features/chat/chat-human-timeline-model.ts');
  const messageTimelineSource = readRenderer('features/turns/message-timeline-utils.tsx');
  const notificationQuerySource = readRenderer('features/notification/notification-query.ts');
  const preferencesSource = readRenderer('features/settings/settings-preferences-panel.tsx');
  const privacySource = readRenderer('features/settings/settings-privacy-page.tsx');

  assert.match(groupDataSource, /listNimiRealmGroupChats/);
  assert.match(groupDataSource, /commitNimiRealmGroupMessageCandidate/);
  assert.doesNotMatch(groupDataSource, /listRealmGroupChats/);
  assert.doesNotMatch(groupDataSource, /getPlatformClient/);
  assert.doesNotMatch(groupDataSource, /GroupChatsService\./);

  assert.match(notificationPanelSource, /toNimiRealmNotificationListProjection/);
  assert.match(notificationPanelSource, /@nimiplatform\/kit\/core\/notifications/);
  assert.match(notificationPanelSource, /getNimiNotificationCategory/);
  assert.doesNotMatch(notificationPanelSource, /getRealmNotificationCategory/);
  assert.doesNotMatch(notificationPanelSource, /NotificationsService\./);
  assert.doesNotMatch(notificationPanelSource, /function toNotificationListView/);

  for (const source of [humanComposerSource, humanTimelineModelSource, messageTimelineSource]) {
    assert.match(source, /@nimiplatform\/kit\/features\/chat\/realm/);
    assert.doesNotMatch(source, /chat-attachment-contract/);
    assert.doesNotMatch(source, /HumanChatsService\./);
    assert.doesNotMatch(source, /ResourcesService\./);
  }
  assert.doesNotMatch(humanComponentsSource, /chat-attachment-contract/);
  assert.doesNotMatch(humanComponentsSource, /HumanChatsService\./);
  assert.doesNotMatch(humanComponentsSource, /ResourcesService\./);

  assert.match(preferencesSource, /loadNimiRealmUserNotificationSettings/);
  assert.match(preferencesSource, /updateNimiRealmUserNotificationSettings/);
  assert.match(privacySource, /loadNimiRealmUserSettings/);
  assert.match(privacySource, /updateNimiRealmUserSettings/);
  for (const source of [notificationQuerySource, preferencesSource, privacySource]) {
    assert.doesNotMatch(source, /dataSync\./);
  }
});

test('human timeline model remains a Desktop feature hook, not a Kit realm surface', () => {
  const humanTimelineModelSource = readRenderer('features/chat/chat-human-timeline-model.ts');
  const kitChatSource = readTree('kit/features/chat/src');
  const kitRegistrySource = readRepo('.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml');

  assert.match(humanTimelineModelSource, /export function useHumanTimelineModel/);
  assert.match(humanTimelineModelSource, /useAppStore/);
  assert.match(humanTimelineModelSource, /getStreamState/);
  assert.match(humanTimelineModelSource, /role: display\.isMe \? 'human' as const : 'assistant' as const/);

  assert.match(kitRegistrySource, /timeline composition\/display helpers/);
  assert.doesNotMatch(kitChatSource, /useHumanTimelineModel/);
  assert.doesNotMatch(kitChatSource, /HumanTimelineModel/);
  assert.doesNotMatch(kitChatSource, /@renderer\//);
  assert.doesNotMatch(kitChatSource, /useAppStore/);
  assert.doesNotMatch(kitChatSource, /stream-controller/);
});
