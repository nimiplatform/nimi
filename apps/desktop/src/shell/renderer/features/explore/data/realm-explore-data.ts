import type { Realm } from '@nimiplatform/sdk/realm';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';

type RealmExploreApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmExploreErrorEmitter = (
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
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
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
    emitRealmExploreError('load-explore-agents', error, { tag, query, limit });
    throw error;
  }
}

export async function loadExploreFeedItems(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
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
    emitRealmExploreError('load-explore-feed', error, { tag, limit });
    throw error;
  }
}

export async function loadMoreExploreFeedItems(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
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
    emitRealmExploreError('load-more-explore-feed', error, { tag, limit });
    throw error;
  }
}

export const realmExploreData = {
  loadExploreAgents: (input: LoadExploreAgentsInput = {}) =>
    loadExploreAgents(callRealmApi, emitRealmDataError, {
      ...input,
      limit: Math.min(input.limit ?? 20, 100),
    }),
  loadExploreFeed: (tag: string | null = null, limit = 20) =>
    loadExploreFeedItems(callRealmApi, emitRealmDataError, tag, Math.min(limit, 100)),
  loadMoreExploreFeed: (limit = 20, cursor?: string, tag?: string | null) =>
    loadMoreExploreFeedItems(callRealmApi, emitRealmDataError, Math.min(limit, 100), cursor, tag),
};
