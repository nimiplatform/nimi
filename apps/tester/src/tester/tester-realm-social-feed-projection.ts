import {
  executeRealmSocialMutation,
  loadRealmExploreFeedItems,
  loadRealmPostFeed,
} from '@nimiplatform/sdk/realm';

export type TesterRealmSocialFeedProjection = {
  postScope: string;
  exploreCursor: string;
  mutationCount: number;
};

export async function loadTesterRealmSocialFeedProjection(): Promise<TesterRealmSocialFeedProjection> {
  const mutationCalls: string[] = [];
  const callRealm = async <T>(task: (realm: {
    services: {
      PostsService: {
        getHomeFeed: (...args: unknown[]) => Promise<unknown>;
        likePost: (postId: string) => Promise<void>;
      };
      ExploreService: {
        getExploreFeed: (...args: unknown[]) => Promise<unknown>;
      };
    };
  }) => Promise<T>) =>
    task({
      services: {
        PostsService: {
          getHomeFeed: async (_visibility, _worldId, _authorId, _limit, _cursor, scope) => ({
            items: [{ id: 'tester-post', scope }],
            page: { cursor: null, limit: 1, nextCursor: null },
          }),
          likePost: async (postId) => {
            mutationCalls.push(postId);
          },
        },
        ExploreService: {
          getExploreFeed: async (_status, tag, limit, cursor) => ({
            items: [{ id: 'tester-explore', tag, limit }],
            page: { cursor, nextCursor: 'next-tester-explore' },
          }),
        },
      },
    });

  const postFeed = await loadRealmPostFeed(callRealm as never, () => undefined, {
    scope: 'agent_activity',
    limit: 1,
  });
  const exploreFeed = await loadRealmExploreFeedItems(callRealm as never, () => undefined, 'tester', 1, 'cursor-tester');
  await executeRealmSocialMutation(callRealm as never, {
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
