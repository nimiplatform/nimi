import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', relativePath), 'utf8');
}

const postCardSource = readWorkspaceFile('src/shell/renderer/features/home/post-card.tsx');
const articleSource = readWorkspaceFile('src/shell/renderer/features/home/article.tsx');
const collectionsTabSource = readWorkspaceFile('src/shell/renderer/features/profile/collections-tab.tsx');
const contactDetailTabsSource = readWorkspaceFile('src/shell/renderer/features/contacts/contact-detail-view-tabs.tsx');
const enLocaleSource = readWorkspaceFile('src/shell/renderer/locales/en.json');
const zhLocaleSource = readWorkspaceFile('src/shell/renderer/locales/zh.json');
const packetSource = readRepoFile('.nimi/topics/ongoing/2026-04-24-governance-runtime-desktop-gate-repair/packet-wave-2-desktop-saved-post-storage-hardcut.md');

const savedPostTruthPatterns = [
  /nimi\.desktop\.saved-post-ids/,
  /nimi:saved-posts-updated/,
  /savedPostsStorageKey/,
  /SAVED_POSTS_STORAGE_KEY/,
  /SAVED_POSTS_UPDATED_EVENT/,
  /handleSavePost/,
  /isSavedPost/,
  /onSavePost/,
];

test('finding-0023 removes the Home saved-post localStorage ledger and menu action', () => {
  for (const pattern of savedPostTruthPatterns) {
    assert.doesNotMatch(postCardSource, pattern);
    assert.doesNotMatch(articleSource, pattern);
  }
  assert.doesNotMatch(articleSource, /SaveIcon/);
  assert.doesNotMatch(articleSource, /Home\.savePost/);
  assert.doesNotMatch(articleSource, /Home\.saved/);
  assert.match(articleSource, /Home\.copyLink/);
  assert.match(articleSource, /Home\.block/);
  assert.match(articleSource, /Home\.report/);
});

test('finding-0023 removes Profile Collections saved-post storage projection', () => {
  for (const pattern of savedPostTruthPatterns) {
    assert.doesNotMatch(collectionsTabSource, pattern);
  }
  assert.doesNotMatch(collectionsTabSource, /localStorage|sessionStorage|loadPostById|dataSync|PostFeedWithMediaPreview/);
  assert.doesNotMatch(collectionsTabSource, /canManageSavedPosts/);
  assert.match(collectionsTabSource, /Profile\.Collections\.empty/);
  assert.match(contactDetailTabsSource, /<CollectionsTab profileId=\{profileId\} layout="grid" \/>/);
});

test('finding-0023 removes saved-post localization strings from desktop Home and Profile', () => {
  assert.doesNotMatch(enLocaleSource, /Save post|Failed to save post|Post saved|Post removed from saved|saved posts/i);
  assert.doesNotMatch(zhLocaleSource, /收藏帖子|已收藏|加载收藏帖子|收藏的帖子/);
  assert.match(enLocaleSource, /"empty": "No collections yet"/);
  assert.match(zhLocaleSource, /"empty": "暂无合集"/);
});

test('saved-post hardcut packet claims only finding-0023', () => {
  assert.match(packetSource, /packet_id: wave-2-desktop-saved-post-storage-hardcut/);
  assert.match(packetSource, /finding_claims:\n  - finding-0023/);
  assert.doesNotMatch(packetSource, /finding-0010|finding-0013|finding-0016/);
});
