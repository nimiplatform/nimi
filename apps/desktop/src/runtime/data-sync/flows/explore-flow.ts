import type { Realm } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type LoadExploreAgentsInput = {
  tag?: string | null;
  query?: string | null;
  limit?: number;
};

export async function loadExploreAgents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: LoadExploreAgentsInput = {},
) {
  const tag = input.tag?.trim() || undefined;
  const query = input.query?.trim() || undefined;
  const limit = input.limit ?? 20;
  try {
    const result = await callApi(
      (realm) => realm.services.SearchService.searchIndexedUsers(
        limit,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        tag,
        undefined,
        undefined,
        undefined,
        undefined,
        query,
      ),
      '加载探索 Agent 失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-explore-agents', error, { tag, query, limit });
    throw error;
  }
}

export async function loadExploreFeedItems(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  tag: string | null,
  limit: number,
) {
  try {
    const result = await callApi(
      (realm) => realm.services.ExploreService.getExploreFeed(undefined, tag || undefined, limit),
      '加载探索流失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-explore-feed', error, { tag, limit });
    throw error;
  }
}

export async function loadMoreExploreFeedItems(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit: number,
  cursor?: string,
  tag?: string | null,
) {
  if (!cursor) return undefined;

  try {
    const result = await callApi(
      (realm) => realm.services.ExploreService.getExploreFeed(undefined, tag || undefined, limit, cursor),
      '加载更多探索流失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-more-explore-feed', error, { tag, limit });
    throw error;
  }
}
