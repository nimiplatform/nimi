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

test('contacts block action waits for parent DataSync mutation before success UI updates', () => {
  const section = extractFunction(viewSource, 'handleBlockUser');

  assert.match(section, /await props\.onBlockFriend\?\.\(contact\)/);
  assert.doesNotMatch(section, /setBlockedUsers/);
  assert.doesNotMatch(section, /newMap\.set\(contact\.id/);
  assert.match(section, /setBlockingContact\(null\)/);
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

test('contacts remove-friend detail action opens a confirmation gate before mutation', () => {
  const removeSection = extractFunction(viewSource, 'handleRemoveUser');
  const detailRenderSection = viewSource.slice(
    viewSource.indexOf('<ContactDetailView'),
    viewSource.indexOf(') : selectedContact && profileError'),
  );

  assert.match(viewSource, /RemoveFriendConfirmDialog/);
  assert.match(blockedUsersSource, /contactsRemoveFriendConfirmDialog/);
  assert.match(detailRenderSection, /onRemove=\{selectedContact \? \(\) => setRemovingContact\(selectedContact\) : undefined\}/);
  assert.doesNotMatch(detailRenderSection, /props\.onRemoveFriend/);
  assert.match(removeSection, /await props\.onRemoveFriend\(contact\)/);
  assert.match(removeSection, /setSelectedContact\(null\)/);
  assert.match(removeSection, /setRemovingContact\(null\)/);
});

test('contacts remove-friend mutation failures are not treated as success', () => {
  const panelRemoveSection = panelSource.slice(
    panelSource.indexOf('const onRemoveFriend = useCallback'),
    panelSource.indexOf('const onBlockFriend = useCallback'),
  );
  const viewRemoveSection = extractFunction(viewSource, 'handleRemoveUser');

  assert.match(panelRemoveSection, /setFeedback\(\{/);
  assert.match(panelRemoveSection, /throw error;/);
  assert.match(viewRemoveSection, /catch \{/);
  assert.match(viewRemoveSection, /keep the dialog open for retry/);
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
