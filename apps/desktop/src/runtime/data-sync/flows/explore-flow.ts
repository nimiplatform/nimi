import type { Realm } from '@nimiplatform/sdk/realm';
import { store } from '@runtime/state';

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
  store.setExploreLoading(true);
  try {
    const result = await callApi(
      (realm) => realm.services.ExploreService.getExploreFeed(undefined, tag || undefined, limit),
      '加载探索流失败',
    );
    store.setExploreItems(result.items || [], result.nextCursor, result.hasMore);
    return result;
  } catch (error) {
    emitDataSyncError('load-explore-feed', error, { tag, limit });
    store.setExploreLoading(false);
    throw error;
  }
}

export async function loadMoreExploreFeedItems(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit: number,
) {
  const exploreState =
    store.getState<{ cursor: string | null; isLoading: boolean; currentTag: string | null }>(
      'explore',
    ) ?? {
      cursor: null,
      isLoading: false,
      currentTag: null,
    };
  const { cursor, isLoading, currentTag } = exploreState;
  if (!cursor || isLoading) return undefined;

  store.setExploreLoading(true);
  try {
    const result = await callApi(
      (realm) => realm.services.ExploreService.getExploreFeed(undefined, currentTag || undefined, limit, cursor),
      '加载更多探索流失败',
    );
    store.appendExploreItems(result.items || [], result.nextCursor, result.hasMore);
    return result;
  } catch (error) {
    emitDataSyncError('load-more-explore-feed', error, { currentTag, limit });
    store.setExploreLoading(false);
    throw error;
  }
}
