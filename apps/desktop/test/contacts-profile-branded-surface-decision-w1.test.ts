import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function readRepoFile(relativePathFromRepoRoot: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', relativePathFromRepoRoot), 'utf8');
}

const contactsDetailSource = readWorkspaceFile('src/shell/renderer/features/contacts/contact-detail-view-content.tsx');
const contactsDetailShellSource = readWorkspaceFile('src/shell/renderer/features/contacts/contact-detail-view-content-shell.tsx');
const contactsRequestsSource = readWorkspaceFile('src/shell/renderer/features/contacts/contacts-friend-requests.tsx');
const profilePostsSource = readWorkspaceFile('src/shell/renderer/features/profile/posts-tab.tsx');
const profileLikesSource = readWorkspaceFile('src/shell/renderer/features/profile/likes-tab.tsx');
const profileCollectionsSource = readWorkspaceFile('src/shell/renderer/features/profile/collections-tab.tsx');
const profileMediaSource = readWorkspaceFile('src/shell/renderer/features/profile/media-tab.tsx');
const profileGiftsSource = readWorkspaceFile('src/shell/renderer/features/profile/gifts-tab.tsx');
const desktopUiShellSpec = readRepoFile('.nimi/spec/desktop/kernel/ui-shell-contract.md');
const desktopSurfacesSpec = readRepoFile('.nimi/spec/desktop/kernel/tables/renderer-design-surfaces.yaml');
const platformDesignPatternSpec = readRepoFile('.nimi/spec/platform/kernel/design-pattern-contract.md');
const platformUiAdoptionSpec = readRepoFile('.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml');

test('W1 contacts/profile branded decision: hero shell is the only admitted controlled exception cohort', () => {
  assert.match(desktopUiShellSpec, /## D-SHELL-032 — Contacts Profile Branded Surface Split And Hero Exception Freeze/);
  assert.match(contactsDetailSource, /rounded-\[30px\]|backdrop-blur-\[18px\]|#4ECCA3/);
  assert.match(contactsDetailShellSource, /rounded-\[34px\]|rounded-\[30px\]|backdrop-blur-\[18px\]/);
  assert.match(desktopSurfacesSpec, /id: contacts\.profile_detail\.hero_exception[\s\S]*surface_profile: exception[\s\S]*exception_policy: controlled[\s\S]*source_rule: D-SHELL-032/);
  assert.match(desktopSurfacesSpec, /id: contacts\.profile_detail\.shell_exception[\s\S]*surface_profile: exception[\s\S]*exception_policy: controlled[\s\S]*source_rule: D-SHELL-032/);
  assert.match(platformDesignPatternSpec, /desktop contacts profile-detail hero shell/);
  assert.match(platformUiAdoptionSpec, /id: desktop\.contacts\.profile-detail\.exception[\s\S]*exception_policy: controlled_exception/);
});

test('W1 contacts/profile branded decision: feed and request cards are frozen as converging cohorts, not branded exceptions', () => {
  assert.match(contactsRequestsSource, /DesktopCardSurface|bg-\[#4ECCA3\]|rounded-3xl|backdrop-blur-xl/);
  assert.match(profilePostsSource, /DesktopCardSurface|rounded-\[24px\]/);
  assert.match(profileLikesSource, /DesktopCardSurface|rounded-\[24px\]/);
  assert.match(profileCollectionsSource, /DesktopCardSurface|rounded-\[24px\]/);
  assert.match(profileMediaSource, /DesktopCardSurface|rounded-\[22px\]/);
  assert.match(profileGiftsSource, /DesktopCardSurface|rounded-\[24px\]|#4ECCA3/);
  assert.match(desktopSurfacesSpec, /id: contacts\.friend_requests\.cards[\s\S]*surface_profile: secondary[\s\S]*exception_policy: none[\s\S]*source_rule: D-SHELL-032/);
  assert.match(desktopSurfacesSpec, /id: profile\.posts\.cards[\s\S]*surface_profile: secondary[\s\S]*exception_policy: none[\s\S]*source_rule: D-SHELL-032/);
  assert.match(desktopSurfacesSpec, /id: profile\.likes\.cards[\s\S]*surface_profile: secondary[\s\S]*exception_policy: none[\s\S]*source_rule: D-SHELL-032/);
  assert.match(desktopSurfacesSpec, /id: profile\.collections\.cards[\s\S]*surface_profile: secondary[\s\S]*exception_policy: none[\s\S]*source_rule: D-SHELL-032/);
  assert.match(desktopSurfacesSpec, /id: profile\.media\.cards[\s\S]*surface_profile: secondary[\s\S]*exception_policy: none[\s\S]*source_rule: D-SHELL-032/);
  assert.match(desktopSurfacesSpec, /id: profile\.gifts\.cards[\s\S]*surface_profile: secondary[\s\S]*exception_policy: none[\s\S]*source_rule: D-SHELL-032/);
  assert.doesNotMatch(platformUiAdoptionSpec, /desktop\.profile\.(posts|likes|collections|media|gifts)\.exception/);
  assert.doesNotMatch(platformUiAdoptionSpec, /desktop\.contacts\.friend-requests\.exception/);
});
