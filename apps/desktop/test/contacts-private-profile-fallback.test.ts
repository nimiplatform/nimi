import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileModalSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/relationship/profile-detail-modal.tsx'), 'utf8');
const privateProfileSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/relationship/profile-private-state.ts'), 'utf8');
const detailContentSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/relationship/profile-detail-view-content.tsx'), 'utf8');
const profileModelSource = readFileSync(resolve(__dirname, '../src/shell/renderer/features/profile/profile-model.ts'), 'utf8');

test('Profile detail converts private human profile access to an explicit restricted profile state', () => {
  assert.match(privateProfileSource, /ReasonCode\.PRINCIPAL_UNAUTHORIZED/);
  assert.match(privateProfileSource, /return readStatus\(error\) === 403/);
  assert.match(privateProfileSource, /accessState: 'restricted'/);
  assert.match(profileModelSource, /accessState: 'full' \| 'restricted'/);

  assert.doesNotMatch(profileModalSource, /selectedContact/);
  assert.match(profileModalSource, /return toRestrictedContactProfileData\(props\.profileSeed\)/);
});

test('Profile detail private profile fallback does not hide generic load failures', () => {
  assert.match(profileModalSource, /throw error;/);
  assert.match(profileModalSource, /profileQuery\.isError/);
  assert.match(profileModalSource, /<ProfileDetailErrorState/);
});

test('Profile detail private profile fallback does not retry or mutate auth custody', () => {
  assert.match(profileModalSource, /retry: \(failureCount, error\) => !isPrivateProfileAccessError\(error\) && failureCount < 1/);

  const combined = [profileModalSource, privateProfileSource].join('\n');
  assert.doesNotMatch(combined, /clearAuth/);
  assert.doesNotMatch(combined, /runtime\.account\.logout/);
  assert.doesNotMatch(combined, /reauth/i);
});

test('Contact detail renders restricted profiles as private content, not error content', () => {
  assert.match(detailContentSource, /profile\.accessState === 'restricted'/);
  assert.match(detailContentSource, /profile-private-state/);
  assert.match(detailContentSource, /isBlockedProfile=\{input\.isBlockedProfile \|\| isRestrictedProfile\}/);
  assert.match(profileModalSource, /profile\.accessState !== 'restricted'/);
  assert.match(profileModalSource, /!isBlockedProfile/);
  assert.match(profileModalSource, /!profile\.isSource \|\| sourceConnected/);
});
