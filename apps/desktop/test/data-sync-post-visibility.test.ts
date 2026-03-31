import assert from 'node:assert/strict';
import test from 'node:test';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { filterBlockedPosts, getPostAuthorId } from '../src/runtime/data-sync/blocked-content';
import {
  loadLikedPosts,
  loadPostById,
  loadPostFeed,
} from '../src/runtime/data-sync/flows/post-attachment-flow';
import {
  getCachedContacts,
  updateCachedContacts,
} from '../src/runtime/data-sync/flows/profile-flow-social';

type PostDto = RealmModel<'PostDto'>;

async function withBlockedUsers(blockedIds: string[], run: () => Promise<void> | void) {
  const original = getCachedContacts();
  updateCachedContacts({
    ...original,
    blocked: blockedIds.map((id) => ({ id })),
  });
  try {
    await run();
  } finally {
    updateCachedContacts(original);
  }
}

function createRealm(postsService: Record<string, unknown>) {
  return {
    services: {
      PostsService: postsService,
    },
  } as never;
}

function createPost(id: string, authorId: string): PostDto {
  return {
    id,
    authorId,
    author: { id: authorId },
    createdAt: '2026-03-31T00:00:00.000Z',
    visibility: 'PUBLIC',
    attachments: [],
  } as unknown as PostDto;
}

test('blocked-content helper resolves author ids from both top-level and nested author fields', () => {
  assert.equal(getPostAuthorId({ authorId: 'author-1' } as never), 'author-1');
  assert.equal(getPostAuthorId({ author: { id: 'author-2' } } as never), 'author-2');
  assert.equal(getPostAuthorId({ author: { _id: 'author-3' } } as never), 'author-3');
});

test('loadPostFeed returns an empty feed without calling the service for blocked author pages', async () => {
  await withBlockedUsers(['blocked-author'], async () => {
    let calls = 0;

    const feed = await loadPostFeed(
      async () => {
        calls += 1;
        throw new Error('should not be called');
      },
      () => undefined,
      { authorId: 'blocked-author', limit: 15, cursor: 'cursor-1' },
    );

    assert.equal(calls, 0);
    assert.deepEqual(feed.items, []);
    assert.equal(feed.page.cursor, 'cursor-1');
    assert.equal(feed.page.limit, 15);
    assert.equal(feed.page.nextCursor, null);
  });
});

test('loadPostFeed filters blocked authors from unscoped feeds', async () => {
  await withBlockedUsers(['blocked-author'], async () => {
    const feed = await loadPostFeed(
      async (task) => task(createRealm({
        getHomeFeed: async () => ({
          items: [
            createPost('visible-post', 'visible-author'),
            createPost('hidden-post', 'blocked-author'),
          ],
          page: { cursor: null, limit: 20, nextCursor: 'next-1' },
        }),
      })),
      () => undefined,
      { limit: 20 },
    );

    assert.deepEqual(feed.items.map((item) => item.id), ['visible-post']);
    assert.equal(feed.page.nextCursor, 'next-1');
  });
});

test('loadLikedPosts filters blocked authors from liked-post feeds', async () => {
  await withBlockedUsers(['blocked-author'], async () => {
    const feed = await loadLikedPosts(
      async (task) => task(createRealm({
        listLikedPosts: async () => ({
          items: [
            createPost('liked-visible', 'visible-author'),
            createPost('liked-hidden', 'blocked-author'),
          ],
          page: { cursor: null, limit: 20, nextCursor: null },
        }),
      })),
      () => undefined,
      'profile-1',
      20,
    );

    assert.deepEqual(feed.items.map((item) => item.id), ['liked-visible']);
  });
});

test('loadPostById fails closed for blocked-author posts', async () => {
  await withBlockedUsers(['blocked-author'], async () => {
    await assert.rejects(
      () => loadPostById(
        async (task) => task(createRealm({
          getPost: async () => createPost('post-1', 'blocked-author'),
        })),
        () => undefined,
        'post-1',
      ),
      /blocked the author/,
    );
  });
});

test('filterBlockedPosts removes posts for blocked authors only', async () => {
  await withBlockedUsers(['blocked-author'], () => {
    const posts = [
      createPost('post-1', 'visible-author'),
      createPost('post-2', 'blocked-author'),
    ];

    const filtered = filterBlockedPosts(posts);
    assert.deepEqual(filtered.map((post) => post.id), ['post-1']);
  });
});
