import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeRealmSocialMutation,
  loadRealmExploreAgents,
  loadRealmExploreFeedItems,
  loadRealmPostFeed,
  type RealmFeedScope,
} from '../src/realm/index.js';

function createCallApi(services: Record<string, unknown>) {
  return async <T>(task: (realm: { services: Record<string, unknown> }) => Promise<T>) =>
    task({ services });
}

const CANONICAL_SCOPES: readonly RealmFeedScope[] = ['personal', 'friends', 'agent_activity'];

test('Realm social feed helper forwards canonical scopes and pagination to PostsService', async () => {
  for (const scope of CANONICAL_SCOPES) {
    let observedScope: unknown = 'unset';
    let observedCursor: unknown = 'unset';
    const feed = await loadRealmPostFeed(
      createCallApi({
        PostsService: {
          getHomeFeed: async (...args: unknown[]) => {
            observedCursor = args[4];
            observedScope = args[5];
            return {
              items: [{ id: `post-${scope}` }],
              page: { cursor: 'cursor-2', limit: 15, nextCursor: null },
            };
          },
        },
      }) as never,
      () => undefined,
      { scope, limit: 15, cursor: 'cursor-2' },
    );

    assert.equal(observedCursor, 'cursor-2');
    assert.equal(observedScope, scope);
    assert.deepEqual(feed.items.map((item) => item.id), [`post-${scope}`]);
  }
});

test('Realm social feed helper fails closed and emits action context', async () => {
  const errors: Array<{ action: string; scope?: unknown }> = [];

  await assert.rejects(
    () => loadRealmPostFeed(
      createCallApi({
        PostsService: {
          getHomeFeed: async () => {
            throw new Error('realm feed unavailable');
          },
        },
      }) as never,
      (action, _error, details) => errors.push({ action, scope: details?.scope }),
      { scope: 'friends', limit: 10 },
    ),
    /realm feed unavailable/,
  );

  assert.deepEqual(errors, [{ action: 'load-post-feed', scope: 'friends' }]);
});

test('Realm social mutation executor uses canonical service calls', async () => {
  const calls: string[] = [];
  const callApi = createCallApi({
    PostsService: {
      likePost: async (postId: string) => { calls.push(`post-like:${postId}`); },
      unlikePost: async (postId: string) => { calls.push(`post-unlike:${postId}`); },
    },
  }) as never;

  await executeRealmSocialMutation(callApi, { kind: 'post-like', payload: { postId: 'post-1' } });
  await executeRealmSocialMutation(callApi, { kind: 'post-unlike', payload: { postId: 'post-2' } });

  assert.deepEqual(calls, [
    'post-like:post-1',
    'post-unlike:post-2',
  ]);
});

test('Realm explore helpers forward agent search and feed cursor through SDK', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const callApi = createCallApi({
    SearchService: {
      searchIndexedUsers: async (...args: unknown[]) => {
        calls.push({ method: 'searchIndexedUsers', args });
        return { items: [{ id: 'agent-1' }] };
      },
    },
    ExploreService: {
      getExploreFeed: async (...args: unknown[]) => {
        calls.push({ method: 'getExploreFeed', args });
        return { items: [{ id: 'feed-1' }], page: { nextCursor: 'next-1' } };
      },
    },
  }) as never;

  await loadRealmExploreAgents(callApi, () => undefined, { tag: 'story', query: 'kimi', limit: 12 });
  await loadRealmExploreFeedItems(callApi, () => undefined, 'story', 20, 'cursor-1');

  assert.equal(calls[0]?.method, 'searchIndexedUsers');
  assert.equal(calls[0]?.args[0], 12);
  assert.equal(calls[0]?.args[8], 'story');
  assert.equal(calls[0]?.args[13], 'kimi');
  assert.deepEqual(calls[1], {
    method: 'getExploreFeed',
    args: [undefined, 'story', 20, 'cursor-1'],
  });
});
