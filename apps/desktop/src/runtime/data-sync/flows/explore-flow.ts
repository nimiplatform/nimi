import type { Realm } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

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
