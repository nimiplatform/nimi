import {
  executeNimiRealmSocialMutation,
  loadNimiRealmExploreFeedItems,
  loadNimiRealmPostFeed,
} from '@nimiplatform/sdk/realm';

export type TesterRealmSocialFeedProjection = {
  postScope: string;
  exploreCursor: string;
  mutationCount: number;
};

export async function loadTesterRealmSocialFeedProjection(): Promise<TesterRealmSocialFeedProjection> {
  const mutationCalls: string[] = [];
  const realm = {
    generated: {
      getHomeFeed: async (request: { query?: { scope?: string } }) => ({
        items: [{ id: 'tester-post', scope: request.query?.scope }],
        page: { cursor: null, limit: 1, nextCursor: null },
      }),
      likePost: async (request: { path: { postId: string } }) => {
        mutationCalls.push(request.path.postId);
      },
      getExploreFeed: async (request: { query?: { tag?: string; limit?: number; cursor?: string } }) => ({
        items: [{ id: 'tester-explore', tag: request.query?.tag, limit: request.query?.limit }],
        page: { cursor: request.query?.cursor, nextCursor: 'next-tester-explore' },
      }),
    },
  };

  const postFeed = await loadNimiRealmPostFeed(realm as never, () => undefined, {
    scope: 'friends',
    limit: 1,
  });
  const exploreFeed = await loadNimiRealmExploreFeedItems(realm as never, () => undefined, 'tester', 1, 'cursor-tester');
  await executeNimiRealmSocialMutation(realm as never, {
    kind: 'post-like',
    payload: { postId: 'tester-post' },
  });

  const firstPost = postFeed.items[0] as { scope?: string } | undefined;
  const explorePage = (exploreFeed as { page?: { cursor?: string } }).page;

  return {
    postScope: String(firstPost?.scope || 'none'),
    exploreCursor: String(explorePage?.cursor || 'none'),
    mutationCount: mutationCalls.length,
  };
}
