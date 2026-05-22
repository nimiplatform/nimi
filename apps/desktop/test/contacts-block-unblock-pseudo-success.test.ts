import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/contacts/contacts-view.tsx'), 'utf8');
const panelSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/contacts/contacts-panel.tsx'), 'utf8');
const blockedUsersSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/contacts/contacts-blocked-users.tsx'), 'utf8');
const profileModalSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/contacts/contact-detail-profile-modal.tsx'), 'utf8');

function extractFunction(source: string, name: string): string {
  const marker = `const ${name} = async`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must be async`);
  const nextMarker = source.indexOf('\n  const ', start + marker.length);
  assert.notEqual(nextMarker, -1, `${name} section must be bounded`);
  return source.slice(start, nextMarker);
}

function extractCallback(source: string, name: string): string {
  const marker = `const ${name} = useCallback`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must be a callback`);
  const nextConst = source.indexOf('\n  const ', start + marker.length);
  const nextRenderGuard = source.indexOf('\n  if (!props.open)', start + marker.length);
  const candidates = [nextConst, nextRenderGuard].filter((value) => value !== -1);
  assert.notEqual(candidates.length, 0, `${name} section must be bounded`);
  return source.slice(start, Math.min(...candidates));
}

test('retired contacts detail pane no longer owns block success state', () => {
  assert.doesNotMatch(viewSource, /const handleBlockUser = async/);
  assert.doesNotMatch(viewSource, /BlockConfirmDialog/);
  assert.doesNotMatch(viewSource, /setBlockingContact/);
});

test('contact profile modal block action waits for DataSync mutation before success UI updates', () => {
  const section = extractCallback(profileModalSource, 'handleBlock');

  assert.match(section, /await dataSync\.blockUser\(\{/);
  assert.match(section, /await Promise\.all\(\[/);
  assert.doesNotMatch(section, /setBlockedUsers/);
  assert.doesNotMatch(section, /newMap\.set\(profile\.id/);
  assert.match(section, /props\.onClose\(\)/);
  assert.match(section, /catch \(error\) \{/);
  assert.match(section, /setFeedback\(\{/);
});

test('contacts unblock action waits for parent DataSync mutation before success UI updates', () => {
  const section = extractFunction(viewSource, 'handleUnblockUser');

  assert.match(section, /await props\.onUnblockUser\?\.\(contact\)/);
  assert.doesNotMatch(section, /setBlockedUsers/);
  assert.doesNotMatch(section, /newMap\.delete\(contact\.id/);
  assert.match(section, /setUnblockingContact\(null\)/);
});

test('contacts panel rethrows block and unblock mutation failures after feedback', () => {
  const blockSection = panelSource.slice(
    panelSource.indexOf('const onBlockFriend = useCallback'),
    panelSource.indexOf('const onUnblockUser = useCallback'),
  );
  const unblockSection = panelSource.slice(
    panelSource.indexOf('const onUnblockUser = useCallback'),
    panelSource.indexOf('const onMessage = useCallback'),
  );

  assert.match(blockSection, /setFeedback\(\{/);
  assert.match(blockSection, /throw error;/);
  assert.match(unblockSection, /setFeedback\(\{/);
  assert.match(unblockSection, /throw error;/);
});

test('retired contacts detail pane no longer owns remove-friend mutation', () => {
  assert.doesNotMatch(viewSource, /const handleRemoveUser = async/);
  assert.doesNotMatch(viewSource, /RemoveFriendConfirmDialog/);
  assert.doesNotMatch(viewSource, /setRemovingContact/);
});

test('contact profile modal remove-friend action opens a confirmation gate before mutation', () => {
  const modalRemoveSection = extractCallback(profileModalSource, 'handleRemove');
  const modalRenderSection = profileModalSource.slice(
    profileModalSource.indexOf('<ContactDetailView'),
    profileModalSource.indexOf('</OverlayShell>'),
  );

  assert.match(profileModalSource, /RemoveFriendConfirmDialog/);
  assert.match(blockedUsersSource, /contactsRemoveFriendConfirmDialog/);
  assert.match(modalRenderSection, /onRemove=\{!isBlockedProfile && profile\.isFriend \? \(\) => setRemoveConfirmOpen\(true\) : undefined\}/);
  assert.doesNotMatch(modalRenderSection, /dataSync\.removeFriend/);
  assert.match(modalRemoveSection, /await dataSync\.removeFriend\(profile\.id\)/);
  assert.match(modalRemoveSection, /setRemoveConfirmOpen\(false\)/);
  assert.match(modalRemoveSection, /props\.onClose\(\)/);
});

test('contacts remove-friend mutation failures are not treated as success', () => {
  const panelRemoveSection = panelSource.slice(
    panelSource.indexOf('const onRemoveFriend = useCallback'),
    panelSource.indexOf('const onBlockFriend = useCallback'),
  );
  const modalRemoveSection = extractCallback(profileModalSource, 'handleRemove');

  assert.match(panelRemoveSection, /setFeedback\(\{/);
  assert.match(panelRemoveSection, /throw error;/);
  assert.match(modalRemoveSection, /catch \(error\) \{/);
  assert.match(modalRemoveSection, /setFeedback\(\{/);
  const modalRemoveCatchSection = modalRemoveSection.slice(modalRemoveSection.indexOf('catch (error) {'));
  assert.doesNotMatch(modalRemoveCatchSection, /props\.onClose\(\)/);
  assert.doesNotMatch(modalRemoveCatchSection, /setRemoveConfirmOpen\(false\)/);
});

test('contact profile modal remove-friend action requires confirmation before DataSync mutation', () => {
  const modalRemoveStart = profileModalSource.indexOf('const handleRemove = useCallback');
  const modalRemoveSection = profileModalSource.slice(
    modalRemoveStart,
    profileModalSource.indexOf('if (!props.open)', modalRemoveStart),
  );
  const modalRenderSection = profileModalSource.slice(
    profileModalSource.indexOf('<ContactDetailView'),
    profileModalSource.indexOf('</OverlayShell>'),
  );

  assert.match(profileModalSource, /RemoveFriendConfirmDialog/);
  assert.match(modalRenderSection, /onRemove=\{!isBlockedProfile && profile\.isFriend \? \(\) => setRemoveConfirmOpen\(true\) : undefined\}/);
  assert.doesNotMatch(modalRenderSection, /dataSync\.removeFriend/);
  assert.match(modalRemoveSection, /setRemoveMutationPending\(true\)/);
  assert.match(modalRemoveSection, /await dataSync\.removeFriend\(profile\.id\)/);
  assert.match(profileModalSource, /onConfirm=\{\(\) => \{\s*void handleRemove\(\);/);
  assert.match(profileModalSource, /if \(!removeMutationPending\) \{\s*setRemoveConfirmOpen\(false\);/);
});
