import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const homeViewSource = readWorkspaceFile('src/shell/renderer/features/home/home-view.tsx');
const homeFeedControlsSource = readWorkspaceFile('src/shell/renderer/features/home/home-feed-controls.tsx');
const postFeedSource = readWorkspaceFile('src/shell/renderer/features/home/post-feed.tsx');
const postFeedDataSource = readWorkspaceFile('src/shell/renderer/features/social/data/post-feed-data.ts');
const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const mainLayoutTitlebarContentSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-titlebar-content.tsx');
const mainLayoutTopBarSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');

test('Desktop post feed delegates Realm service scope and pagination behavior to SDK', () => {
  assert.match(postFeedDataSource, /loadNimiRealmPostFeed/);
  assert.doesNotMatch(postFeedDataSource, /loadRealmPostFeed/);
  assert.match(postFeedDataSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.doesNotMatch(postFeedDataSource, /realm\.services\.PostsService\.getHomeFeed/);
});

test('Home feed controls present the canonical core feed scopes (D-HOMEFEED-004)', () => {
  assert.match(homeFeedControlsSource, /NIMI_REALM_FEED_SCOPES/);
  assert.match(homeFeedControlsSource, /HOME_FEED_SCOPES\s*=\s*NIMI_REALM_FEED_SCOPES/);
  assert.match(homeFeedControlsSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.doesNotMatch(homeFeedControlsSource, /PostFeedScope/);
  assert.doesNotMatch(homeFeedControlsSource, /@runtime\/data-sync/);
});

test('HomeView reads each scope through the SDK typed feed projection (D-HOMEFEED-006)', () => {
  // The feed read goes through realmSocialData.loadPostFeed (SDK typed Realm path),
  // carrying the active scope. No renderer-local REST fetch.
  assert.match(homeViewSource, /realmSocialData\.loadPostFeed\(\{\s*scope:\s*props\.feedScope,/s);
  assert.doesNotMatch(homeViewSource, /\bfetch\(/);
});

test('PostFeed does not terminate pagination only because a filtered page is empty', () => {
  assert.match(postFeedSource, /items\.length === 0 && nextCursor == null/);
  assert.doesNotMatch(postFeedSource, /if \(items\.length === 0\) \{/);
});

test('PostFeed classifies SDK Realm HTTP 401 from error details as session expiry', () => {
  assert.match(postFeedSource, /details\?: \{ status\?: number \| string \}/);
  assert.match(postFeedSource, /function apiErrorStatus\(error: ApiError\): number \| null/);
  assert.match(postFeedSource, /Number\(error\.status \?\? error\.response\?\.status \?\? error\.details\?\.status\)/);
  assert.match(postFeedSource, /if \(apiErrorStatus\(loadError\) === 401\)/);
});

test('HomeView remounts PostFeed per scope so scope reads are not cross-contaminated', () => {
  assert.match(homeViewSource, /postFeedKey\s*=\s*`moments-\$\{props\.feedScope\}-\$\{refreshKey\}`/);
  assert.match(homeViewSource, /<PostFeed\s+key=\{postFeedKey\}/s);
});

test('HomeView does not carry AI execution payload on the feed path (D-HOMEFEED-007)', () => {
  assert.doesNotMatch(homeViewSource, /AIScopeRef/);
  assert.doesNotMatch(homeViewSource, /loadPostFeed\([^)]*provider/s);
});

test('Home presents feed scope controls in the shell header', () => {
  assert.doesNotMatch(homeViewSource, /SegmentedControl/);
  assert.doesNotMatch(homeViewSource, /Home\.pageTitle/);
  assert.match(homeFeedControlsSource, /HOME_FEED_SCOPES\.map\(\(scope\) =>/);
  assert.match(homeFeedControlsSource, /<button[\s\S]*key=\{scope\}[\s\S]*onClick=\{\(\) => onSelect\(scope\)\}/);
  // Visual contract: Home tabs adopt explore-style text-only treatment: no icon glyph, no pill background.
  assert.doesNotMatch(homeFeedControlsSource, /function HomeFeedScopeIcon/);
  assert.doesNotMatch(homeFeedControlsSource, /<HomeFeedScopeIcon /);
  assert.doesNotMatch(homeFeedControlsSource, /DOT_TONE_BY_SCOPE/);
  assert.match(mainLayoutViewSource, /<MainLayoutTitlebarContent/);
  assert.match(mainLayoutTitlebarContentSource, /props\.activeTab === 'home'/);
  assert.match(mainLayoutTitlebarContentSource, /<HomeFeedScopeNav[\s\S]*active=\{props\.homeFeedScope\}/);
  assert.match(mainLayoutTopBarSource, /<HomeCreatePostButton/);
  assert.match(homeViewSource, /HOME_FEED_WIDE_MEDIA_QUERY\s*=\s*'\(min-width: 1280px\)'/);
  assert.match(homeViewSource, /max-w-\[560px\]/);
  assert.match(homeViewSource, /max-w-\[1144px\]/);
  assert.doesNotMatch(homeViewSource, /max-w-\[760px\]/);
  assert.match(homeViewSource, /const homeFeedColumns = useHomeFeedColumns\(\)/);
  assert.match(homeViewSource, /columns=\{homeFeedColumns\}/);
});

test('Home shell header uses title typography for feed scopes and post action', () => {
  const displayFontUses = homeFeedControlsSource.match(/fontFamily:\s*'var\(--nimi-font-display\)'/g) ?? [];
  assert.equal(displayFontUses.length, 2);
  assert.match(homeFeedControlsSource, /text-\[16px\][\s\S]*font-semibold/);
  assert.match(homeFeedControlsSource, /text-\[14px\][\s\S]*font-semibold/);
  assert.doesNotMatch(homeFeedControlsSource, /fontFamily:\s*'var\(--nimi-font-sans\)'/);
});
