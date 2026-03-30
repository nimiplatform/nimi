import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { toSafeBackgroundImage } from '../src/shell/renderer/features/explore/explore-cards';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const addFriendModalSource = readSource('../src/shell/renderer/features/home/add-friend-modal.tsx');
const addContactModalSource = readSource('../src/shell/renderer/features/contacts/add-contact-modal.tsx');
const explorePanelSource = readSource('../src/shell/renderer/features/explore/explore-panel.tsx');
const contactsViewSource = readSource('../src/shell/renderer/features/contacts/contacts-view.tsx');
const contactsFriendRequestsSource = readSource('../src/shell/renderer/features/contacts/contacts-friend-requests.tsx');
const homeViewSource = readSource('../src/shell/renderer/features/home/home-view.tsx');
const notificationPanelSource = readSource('../src/shell/renderer/features/notification/notification-panel.tsx');
const notificationRejectDialogSource = readSource('../src/shell/renderer/features/notification/notification-reject-gift-dialog.tsx');
const postCardSource = readSource('../src/shell/renderer/features/home/post-card.tsx');
const contactDetailTabsSource = readSource('../src/shell/renderer/features/contacts/contact-detail-view-tabs.tsx');
const contactDetailProfileModalSource = readSource('../src/shell/renderer/features/contacts/contact-detail-profile-modal.tsx');
const runtimeConfigSystemResourcesSource = readSource('../src/shell/renderer/features/runtime-config/runtime-config-system-resources.ts');
const profilePostFeedSource = readSource('../src/shell/renderer/features/profile/post-feed-with-media-preview.tsx');
const profilePostsTabSource = readSource('../src/shell/renderer/features/profile/posts-tab.tsx');
const profilePanelSource = readSource('../src/shell/renderer/features/profile/profile-panel.tsx');
const createPostModalSource = readSource('../src/shell/renderer/features/profile/create-post-modal.tsx');
const createPostModalPanelsSource = readSource('../src/shell/renderer/features/profile/create-post-modal-panels.tsx');
const giftsTabSource = readSource('../src/shell/renderer/features/profile/gifts-tab.tsx');
const sendGiftModalSource = readSource('../src/shell/renderer/features/economy/send-gift-modal.tsx');
const dialogPrimitiveSource = readSource('../../../kit/ui/src/components/dialog.tsx');
const designSurfacesTable = readSource('../../../spec/desktop/kernel/tables/renderer-design-surfaces.yaml');
const designOverlaysTable = readSource('../../../spec/desktop/kernel/tables/renderer-design-overlays.yaml');

test('top agent cards sanitize banner URLs before interpolating them into background images', () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: {
        href: 'https://app.nimi.example/explore',
      },
    },
    configurable: true,
  });
  try {
    assert.equal(toSafeBackgroundImage('javascript:alert(1)'), null);
    assert.equal(toSafeBackgroundImage('data:text/html,boom'), null);
    assert.equal(
      toSafeBackgroundImage('https://cdn.nimi.example/banner.png'),
      'url("https://cdn.nimi.example/banner.png")',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
});

test('explore panel keeps agent queries declarative without imperative refetch loops', () => {
  assert.match(explorePanelSource, /queryKey: \['explore-agents', authStatus, selectedCategory, searchText\]/);
  assert.doesNotMatch(explorePanelSource, /agentsQuery\.refetch\(\)/);
});

test('add friend modal forwards the typed greeting message to the add-friend action', () => {
  assert.match(addFriendModalSource, /onAddFriend: \(message\?: string\) => Promise<void>/);
  assert.match(addFriendModalSource, /await onAddFriend\(message\.trim\(\) \|\| undefined\)/);
  assert.match(postCardSource, /dataSync\.requestOrAcceptFriend\(authorId, message\)/);
});

test('add contact modal localizes footer action labels instead of hardcoding English strings', () => {
  assert.match(addContactModalSource, /t\('Contacts\.sending', \{ defaultValue: 'Sending\.\.\.' \}\)/);
  assert.match(addContactModalSource, /t\('Contacts\.addContactTitle', \{ defaultValue: 'Add Contact' \}\)/);
  assert.doesNotMatch(addContactModalSource, /\n\s*Sending\.\.\.\n/);
  assert.doesNotMatch(addContactModalSource, /\n\s*'Add Contact'\n/);
});

test('contacts view no longer relies on a non-null assertion for selected profiles and keeps comments accurate', () => {
  assert.doesNotMatch(contactsViewSource, /selectedProfile!/);
  assert.match(contactsViewSource, /selectedContact && selectedProfile/);
  assert.doesNotMatch(contactsViewSource, /return toProfileData\(fallbackProfile\)/);
  assert.doesNotMatch(contactDetailProfileModalSource, /toSeedProfileData/);
  assert.doesNotMatch(contactDetailProfileModalSource, /profileQuery\.data \|\| fallbackProfile/);
  assert.doesNotMatch(contactsViewSource, /跟踪已接受的好友请求/);
  assert.match(contactsViewSource, /处理联系人侧栏拖拽缩放/);
});

test('runtime config system resources use explicit availability state instead of fake snapshots', () => {
  assert.match(runtimeConfigSystemResourcesSource, /SystemResourceStatus = 'idle' \| 'loading' \| 'ready' \| 'unavailable' \| 'stale'/);
  assert.doesNotMatch(runtimeConfigSystemResourcesSource, /fallbackSnapshot/);
  assert.match(runtimeConfigSystemResourcesSource, /status: prev\.snapshot \? 'stale' : 'unavailable'/);
});

test('contacts friend requests view does not carry an unused React default import', () => {
  assert.doesNotMatch(contactsFriendRequestsSource, /import React from 'react'/);
});

test('home and notification surfaces import shared design primitives from nimi-kit directly', () => {
  assert.match(homeViewSource, /@nimiplatform\/nimi-kit\/ui/);
  assert.match(notificationPanelSource, /@nimiplatform\/nimi-kit\/ui/);
  assert.match(notificationRejectDialogSource, /@nimiplatform\/nimi-kit\/ui/);
});

test('design governance tables register secondary profile and overlay consumers explicitly', () => {
  assert.match(designSurfacesTable, /id: profile\.panel\.root/);
  assert.match(designSurfacesTable, /module: features\/profile\/profile-panel\.tsx/);
  assert.match(designSurfacesTable, /id: contacts\.profile_detail\.surface/);
  assert.match(designSurfacesTable, /module: features\/contacts\/contact-detail-view-content\.tsx/);
  assert.match(designSurfacesTable, /id: economy\.send_gift\.dialog_surface/);
  assert.match(designSurfacesTable, /module: features\/economy\/send-gift-modal\.tsx/);
  assert.match(designOverlaysTable, /id: notification\.reject_gift/);
  assert.match(designOverlaysTable, /module: features\/notification\/notification-reject-gift-dialog\.tsx/);
  assert.match(designOverlaysTable, /id: contacts\.profile_detail_modal/);
  assert.match(designOverlaysTable, /id: economy\.send_gift/);
  assert.match(designOverlaysTable, /id: profile\.create_post/);
  assert.match(designOverlaysTable, /id: profile\.create_post_popovers/);
  assert.match(designOverlaysTable, /id: profile\.top_supporters/);
});

test('governed secondary overlays import shared nimi-kit overlay surfaces directly', () => {
  assert.match(sendGiftModalSource, /@nimiplatform\/nimi-kit\/features\/commerce\/ui/);
  assert.match(createPostModalSource, /@nimiplatform\/nimi-kit\/ui/);
  assert.match(createPostModalPanelsSource, /@nimiplatform\/nimi-kit\/ui/);
  assert.match(contactDetailProfileModalSource, /@nimiplatform\/nimi-kit\/ui/);
  assert.match(giftsTabSource, /@nimiplatform\/nimi-kit\/ui/);
});

test('governed roots and overlays expose stable testability hooks', () => {
  assert.match(homeViewSource, /data-testid=\{E2E_IDS\.panel\('home'\)\}/);
  assert.match(notificationPanelSource, /data-testid=\{E2E_IDS\.panel\('notification'\)\}/);
  assert.match(profilePanelSource, /data-testid=\{E2E_IDS\.panel\('profile'\)\}/);
  assert.match(sendGiftModalSource, /dataTestId=\{E2E_IDS\.sendGiftDialog\}/);
  assert.match(createPostModalSource, /dataTestId=\{E2E_IDS\.createPostDialog\}/);
  assert.match(createPostModalPanelsSource, /dataTestId=\{E2E_IDS\.createPostEmojiPanel\}/);
  assert.match(createPostModalPanelsSource, /dataTestId=\{E2E_IDS\.createPostLocationPanel\}/);
  assert.match(createPostModalPanelsSource, /dataTestId=\{E2E_IDS\.createPostTagPanel\}/);
  assert.match(contactDetailProfileModalSource, /dataTestId=\{E2E_IDS\.contactDetailProfileModal\}/);
  assert.match(giftsTabSource, /dataTestId=\{E2E_IDS\.profileTopSupportersDialog\}/);
});

test('dialog primitive keeps data-testid passthrough and panel style support for governed overlays', () => {
  assert.match(dialogPrimitiveSource, /data-testid=\{dataTestId\}/);
  assert.match(dialogPrimitiveSource, /style=\{panelStyle\}/);
});

test('profile post feeds keep a stable two-column breakpoint instead of a late private width threshold', () => {
  assert.match(profilePostFeedSource, /sm:grid-cols-2/);
  assert.match(profilePostFeedSource, /sm:columns-2/);
  assert.doesNotMatch(profilePostFeedSource, /min-\[980px\]:(grid-cols-2|columns-2|col-span-2)/);
  assert.match(profilePostsTabSource, /sm:grid-cols-2/);
  assert.doesNotMatch(profilePostsTabSource, /min-\[980px\]:grid-cols-2/);
});

test('contact detail feed tabs use stable grid layout instead of masonry in profile detail surfaces', () => {
  assert.match(contactDetailTabsSource, /<PostsTab profileId=\{profileId\} layout="grid" \/>/);
  assert.doesNotMatch(contactDetailTabsSource, /<PostsTab profileId=\{profileId\} layout="masonry" \/>/);
  assert.match(contactDetailTabsSource, /<CollectionsTab profileId=\{profileId\} canManageSavedPosts=\{isOwnProfile\} layout="grid" \/>/);
  assert.doesNotMatch(contactDetailTabsSource, /<CollectionsTab profileId=\{profileId\} canManageSavedPosts=\{isOwnProfile\} layout="masonry" \/>/);
  assert.match(contactDetailTabsSource, /<LikesTab profileId=\{profileId\} layout="grid" \/>/);
  assert.doesNotMatch(contactDetailTabsSource, /<LikesTab profileId=\{profileId\} layout="masonry" \/>/);
});
