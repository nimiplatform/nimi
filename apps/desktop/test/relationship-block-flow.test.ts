import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileModalSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/relationship/profile-detail-modal.tsx'), 'utf8');
const profileDialogsSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/relationship/profile-detail-dialogs.tsx'), 'utf8');

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

test('profile detail modal block action waits for Realm mutation before closing', () => {
  const section = extractCallback(profileModalSource, 'handleBlock');

  assert.match(section, /await dataSync\.blockUser\(\{/);
  assert.match(section, /await Promise\.all\(\[/);
  assert.doesNotMatch(section, /setBlockedUsers/);
  assert.doesNotMatch(section, /newMap\.set\(profile\.id/);
  assert.match(section, /props\.onClose\(\)/);
  assert.match(section, /catch \(error\) \{/);
  assert.match(section, /setFeedback\(\{/);
});

test('profile detail modal remove-friend action opens a confirmation gate before mutation', () => {
  const modalRemoveSection = extractCallback(profileModalSource, 'handleRemove');
  const modalRenderSection = profileModalSource.slice(
    profileModalSource.indexOf('<ProfileDetailView'),
    profileModalSource.indexOf('</OverlayShell>'),
  );

  assert.match(profileModalSource, /RemoveFriendConfirmDialog/);
  assert.match(profileDialogsSource, /profileRemoveFriendConfirmDialog/);
  assert.match(modalRenderSection, /onRemove=\{!isBlockedProfile && profile\.isFriend \? \(\) => setRemoveConfirmOpen\(true\) : undefined\}/);
  assert.doesNotMatch(modalRenderSection, /dataSync\.removeFriend/);
  assert.match(modalRemoveSection, /setRemoveMutationPending\(true\)/);
  assert.match(modalRemoveSection, /await dataSync\.removeFriend\(profile\.id\)/);
  assert.match(modalRemoveSection, /setRemoveConfirmOpen\(false\)/);
  assert.match(modalRemoveSection, /props\.onClose\(\)/);
});

test('profile detail modal remove-friend mutation failures are not treated as success', () => {
  const modalRemoveSection = extractCallback(profileModalSource, 'handleRemove');

  assert.match(modalRemoveSection, /catch \(error\) \{/);
  assert.match(modalRemoveSection, /setFeedback\(\{/);
  const modalRemoveCatchSection = modalRemoveSection.slice(modalRemoveSection.indexOf('catch (error) {'));
  assert.doesNotMatch(modalRemoveCatchSection, /props\.onClose\(\)/);
  assert.doesNotMatch(modalRemoveCatchSection, /setRemoveConfirmOpen\(false\)/);
});
