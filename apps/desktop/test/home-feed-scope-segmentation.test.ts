import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import {
  loadPostFeed,
  type PostFeedScope,
} from '../src/runtime/data-sync/flows/post-attachment-flow';

type PostDto = RealmModel<'PostDto'>;

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function createRealm(getHomeFeed: (...args: unknown[]) => Promise<unknown>) {
  return {
    services: {
      PostsService: { getHomeFeed },
    },
  } as never;
}

function createPost(id: string, authorId: string): PostDto {
  return {
    id,
    authorId,
    author: { id: authorId },
    createdAt: '2026-05-21T00:00:00.000Z',
    visibility: 'PUBLIC',
    attachments: [],
  } as unknown as PostDto;
}

const CANONICAL_SCOPES: readonly PostFeedScope[] = ['personal', 'friends', 'agent_activity'];

// D-HOMEFEED-004 / D-HOMEFEED-006 / R-FEED-005: each of the three canonical
// feed scopes must be forwarded verbatim through the SDK typed Realm feed
// projection. The renderer never infers scope membership client-side.
test('loadPostFeed forwards each canonical scope as the SDK getHomeFeed scope arg', async () => {
  for (const scope of CANONICAL_SCOPES) {
    let observedScope: unknown = '<<unset>>';

    const feed = await loadPostFeed(
      async (task) =>
        task(createRealm(async (...args: unknown[]) => {
          // getHomeFeed(visibility, worldId, authorId, limit, cursor, scope)
          observedScope = args[5];
          return {
            items: [createPost(`post-${scope}`, `author-${scope}`)],
            page: { cursor: null, limit: 15, nextCursor: null },
          };
        })),
      () => undefined,
      { scope, limit: 15 },
    );

    assert.equal(observedScope, scope, `scope ${scope} must reach the SDK getHomeFeed call`);
    assert.deepEqual(feed.items.map((item) => item.id), [`post-${scope}`]);
  }
});

test('loadPostFeed forwards the cursor for scope-keyed pagination (R-FEED-006)', async () => {
  let observedCursor: unknown = '<<unset>>';
  let observedScope: unknown = '<<unset>>';

  await loadPostFeed(
    async (task) =>
      task(createRealm(async (...args: unknown[]) => {
        observedCursor = args[4];
        observedScope = args[5];
        return {
          items: [],
          page: { cursor: 'cursor-page-2', limit: 15, nextCursor: null },
        };
      })),
    () => undefined,
    { scope: 'agent_activity', limit: 15, cursor: 'cursor-page-2' },
  );

  assert.equal(observedCursor, 'cursor-page-2');
  assert.equal(observedScope, 'agent_activity');
});

test('loadPostFeed fails closed when the typed feed projection throws — no synthetic feed', async () => {
  const errors: Array<{ action: string }> = [];

  await assert.rejects(
    () =>
      loadPostFeed(
        async (task) =>
          task(createRealm(async () => {
            throw new Error('realm feed projection unavailable');
          })),
        (action) => {
          errors.push({ action });
        },
        { scope: 'friends', limit: 15 },
      ),
    /realm feed projection unavailable/,
  );
  assert.deepEqual(errors, [{ action: 'load-post-feed' }]);
});

const homeViewSource = readWorkspaceFile('src/shell/renderer/features/home/home-view.tsx');
const homeFeedControlsSource = readWorkspaceFile('src/shell/renderer/features/home/home-feed-controls.tsx');
const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const mainLayoutTitlebarContentSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-titlebar-content.tsx');

test('Home feed controls present exactly the three canonical feed scopes (D-HOMEFEED-004)', () => {
  assert.match(
    homeFeedControlsSource,
    /HOME_FEED_SCOPES:\s*readonly PostFeedScope\[\]\s*=\s*\[\s*'personal',\s*'friends',\s*'agent_activity',?\s*\]/,
  );
});

test('HomeView reads each scope through the SDK typed feed projection (D-HOMEFEED-006)', () => {
  // The feed read goes through dataSync.loadPostFeed (SDK typed Realm path),
  // carrying the active scope. No renderer-local REST fetch.
  assert.match(homeViewSource, /dataSync\.loadPostFeed\(\{\s*scope:\s*props\.feedScope,/s);
  assert.doesNotMatch(homeViewSource, /\bfetch\(/);
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
  assert.match(mainLayoutTitlebarContentSource, /<HomeCreatePostButton/);
  assert.match(homeViewSource, /max-w-\[760px\]/);
});
