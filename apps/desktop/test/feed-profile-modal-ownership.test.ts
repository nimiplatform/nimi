import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const postCardSource = readWorkspaceFile('src/shell/renderer/features/home/post-card.tsx');
const homeViewSource = readWorkspaceFile('src/shell/renderer/features/home/home-view.tsx');
const exploreViewSource = readWorkspaceFile('src/shell/renderer/features/explore/explore-view.tsx');
const explorePanelSource = readWorkspaceFile('src/shell/renderer/features/explore/explore-panel.tsx');

test('feed profile modal ownership: PostCard exposes parent-owned author profile hook', () => {
  assert.match(
    postCardSource,
    /onOpenAuthorProfile\?:\s*\(target:\s*PostCardAuthorProfileTarget\)\s*=>\s*void;/,
  );
  assert.match(
    postCardSource,
    /if\s*\(onOpenAuthorProfile\)\s*\{\s*onOpenAuthorProfile\(\{\s*profileId:\s*authorId,\s*profileSeed:\s*authorProfileSeed,\s*\}\);\s*return;\s*\}/s,
  );
});

test('feed profile modal ownership: HomeView keeps feed profile state locally', () => {
  assert.match(
    homeViewSource,
    /const\s*\[\s*selectedFeedProfile,\s*setSelectedFeedProfile\s*\]\s*=\s*useState<PostCardAuthorProfileTarget \| null>\(null\);/,
  );
  assert.match(homeViewSource, /onOpenAuthorProfile=\{setSelectedFeedProfile\}/);
  assert.match(homeViewSource, /profileId=\{selectedFeedProfile\?\.profileId \|\| ''\}/);
  assert.doesNotMatch(homeViewSource, /selectedProfileId/);
});

test('feed profile modal ownership: Toast timer does not depend on unstable inline callbacks', () => {
  assert.match(homeViewSource, /const onCloseRef = useRef\(onClose\)/);
  assert.match(homeViewSource, /onCloseRef\.current = onClose/);
  assert.match(homeViewSource, /setTimeout\(\(\) => \{\s*onCloseRef\.current\(\);\s*\}, 3000\)/s);
});

test('feed profile modal ownership: Explore feed forwards post author open to PostCard', () => {
  assert.match(exploreViewSource, /onPostAuthorOpen\?:\s*\(target:\s*PostCardAuthorProfileTarget\)\s*=>\s*void;/);
  assert.match(exploreViewSource, /onOpenAuthorProfile=\{props\.onPostAuthorOpen\}/);
});

test('feed profile modal ownership: ExplorePanel uses a single local profile target', () => {
  assert.match(
    explorePanelSource,
    /const\s*\[\s*selectedProfileTarget,\s*setSelectedProfileTarget\s*\]\s*=\s*useState<PostCardAuthorProfileTarget \| null>\(null\);/,
  );
  assert.match(explorePanelSource, /onPostAuthorOpen=\{setSelectedProfileTarget\}/);
  assert.match(explorePanelSource, /profileId=\{selectedProfileTarget\?\.profileId \|\| ''\}/);
  assert.doesNotMatch(explorePanelSource, /selectedProfileId/);
});
