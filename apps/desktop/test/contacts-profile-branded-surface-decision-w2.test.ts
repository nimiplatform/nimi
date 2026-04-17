import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const profilePostsSource = readWorkspaceFile('src/shell/renderer/features/profile/posts-tab.tsx');
const profileLikesSource = readWorkspaceFile('src/shell/renderer/features/profile/likes-tab.tsx');
const profileCollectionsSource = readWorkspaceFile('src/shell/renderer/features/profile/collections-tab.tsx');
const profileMediaSource = readWorkspaceFile('src/shell/renderer/features/profile/media-tab.tsx');
const profileGiftsSource = readWorkspaceFile('src/shell/renderer/features/profile/gifts-tab.tsx');
const profileFeedWithPreviewSource = readWorkspaceFile('src/shell/renderer/features/profile/post-feed-with-media-preview.tsx');
const contactsRequestsSource = readWorkspaceFile('src/shell/renderer/features/contacts/contacts-friend-requests.tsx');

test('W2 contacts/profile convergence: admitted profile tabs consume shared desktop surface and action primitives', () => {
  assert.match(profilePostsSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(profilePostsSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(profilePostsSource, /<DesktopCardSurface kind="promoted-glass"/);
  assert.match(profilePostsSource, /<DesktopCompactAction tone="danger"/);

  assert.match(profileLikesSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(profileLikesSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(profileLikesSource, /<DesktopCardSurface kind="promoted-glass"/);
  assert.match(profileLikesSource, /<DesktopCompactAction tone="danger"/);

  assert.match(profileCollectionsSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(profileCollectionsSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(profileCollectionsSource, /<DesktopCardSurface kind="promoted-glass"/);
  assert.match(profileCollectionsSource, /<DesktopCompactAction tone="danger"/);

  assert.match(profileMediaSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(profileMediaSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(profileMediaSource, /as="button"[\s\S]*kind="promoted-glass"[\s\S]*interactive/);
  assert.match(profileMediaSource, /<DesktopCompactAction tone="danger"/);

  assert.match(profileGiftsSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(profileGiftsSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(profileGiftsSource, /<DesktopCardSurface kind="promoted-glass"/);
  assert.match(profileGiftsSource, /<DesktopCompactAction[\s\S]*tone="primary"/);
});

test('W2 contacts/profile convergence: helper and friend-request cohort use shared desktop contracts without reopening hero exception', () => {
  assert.match(profileFeedWithPreviewSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(profileFeedWithPreviewSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(profileFeedWithPreviewSource, /ring-\[length:var\(--nimi-focus-ring-width\)\] ring-\[var\(--nimi-focus-ring-color\)\] ring-offset-4 ring-offset-\[var\(--nimi-surface-canvas\)\]/);
  assert.doesNotMatch(profileFeedWithPreviewSource, /ring-\[color:color-mix/);

  assert.match(contactsRequestsSource, /import \{ DesktopCompactAction \} from '@renderer\/components\/action';/);
  assert.match(contactsRequestsSource, /import \{ DesktopCardSurface \} from '@renderer\/components\/surface';/);
  assert.match(contactsRequestsSource, /<DesktopCardSurface kind="operational-solid" as="div" className="relative p-6">/);
  assert.match(contactsRequestsSource, /<DesktopCompactAction[\s\S]*tone="primary"[\s\S]*Contacts\.accept/);
  assert.match(contactsRequestsSource, /<DesktopCompactAction[\s\S]*tone="neutral"[\s\S]*Contacts\.reject/);
  assert.doesNotMatch(contactsRequestsSource, /<button/);
});
