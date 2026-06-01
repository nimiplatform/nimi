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
const profileGiftsSource = readWorkspaceFile('src/shell/renderer/features/profile/gifts-tab.tsx');
const profileFeedWithPreviewSource = readWorkspaceFile('src/shell/renderer/features/profile/post-feed-with-media-preview.tsx');

test('W2 contacts/profile convergence: admitted profile tabs consume kit surface and action primitives', () => {
  assert.match(profilePostsSource, /import \{ AppCardSurface, CompactAction \} from '@nimiplatform\/kit\/ui';/);
  assert.match(profilePostsSource, /<AppCardSurface kind="promoted-glass"/);
  assert.match(profilePostsSource, /<CompactAction tone="danger"/);

  assert.match(profileLikesSource, /import \{ AppCardSurface, CompactAction \} from '@nimiplatform\/kit\/ui';/);
  assert.match(profileLikesSource, /<AppCardSurface kind="promoted-glass"/);
  assert.match(profileLikesSource, /<CompactAction tone="danger"/);

  assert.match(profileCollectionsSource, /import \{ AppCardSurface \} from '@nimiplatform\/kit\/ui';/);
  assert.match(profileCollectionsSource, /<AppCardSurface kind="promoted-glass"/);
  assert.doesNotMatch(profileCollectionsSource, /CompactAction/);

  assert.match(profileGiftsSource, /import \{ AppCardSurface, CompactAction, OverlayShell, ScrollArea \} from '@nimiplatform\/kit\/ui';/);
  assert.match(profileGiftsSource, /<AppCardSurface kind="promoted-glass"/);
  assert.match(profileGiftsSource, /<CompactAction[\s\S]*tone="primary"/);
});

test('W2 profile convergence: helper cohort uses kit contracts without reopening hero exception', () => {
  assert.match(profileFeedWithPreviewSource, /import \{ AppCardSurface, CompactAction \} from '@nimiplatform\/kit\/ui';/);
  assert.match(profileFeedWithPreviewSource, /ring-\[length:var\(--nimi-focus-ring-width\)\] ring-\[var\(--nimi-focus-ring-color\)\] ring-offset-4 ring-offset-\[var\(--nimi-surface-canvas\)\]/);
  assert.doesNotMatch(profileFeedWithPreviewSource, /ring-\[color:color-mix/);
});
