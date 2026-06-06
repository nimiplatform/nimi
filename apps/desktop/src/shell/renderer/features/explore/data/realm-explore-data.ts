import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmGetExploreFeedOperationResponse, RealmSearchIndexedUsersOperationResponse } from '@nimiplatform/sdk/realm/generated';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';

export type LoadExploreAgentsInput = {
  tag?: string | null;
  query?: string | null;
  limit?: number;
};

export type RealmExploreApiCaller = <T>(
  task: (realm: Realm) => Promise<T>,
  fallbackMessage?: string,
) => Promise<T>;

export type RealmExploreErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

function normalizeText(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

export async function loadExploreAgents(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
  input: LoadExploreAgentsInput = {},
): Promise<RealmSearchIndexedUsersOperationResponse> {
  const tag = normalizeText(input.tag);
  const query = normalizeText(input.query);
  const limit = input.limit ?? 20;
  try {
    return await callApi(
      (realm) => realm.generated.searchIndexedUsers({
        path: {},
        query: {
          isAgent: true,
          limit,
          q: query,
          tag,
        },
      }),
      '加载探索 Agent 失败',
    );
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
): Promise<RealmGetExploreFeedOperationResponse> {
  const normalizedTag = normalizeText(tag);
  try {
    return await callApi(
      (realm) => realm.generated.getExploreFeed({
        path: {},
        query: {
          limit,
          tag: normalizedTag,
        },
      }),
      '加载探索流失败',
    );
  } catch (error) {
    emitRealmExploreError('load-explore-feed', error, { tag: normalizedTag, limit });
    throw error;
  }
}

export async function loadMoreExploreFeedItems(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
  limit: number,
  cursor?: string,
  tag?: string | null,
): Promise<RealmGetExploreFeedOperationResponse | undefined> {
  if (!cursor) return undefined;
  const normalizedTag = normalizeText(tag);
  try {
    return await callApi(
      (realm) => realm.generated.getExploreFeed({
        path: {},
        query: {
          cursor,
          limit,
          tag: normalizedTag,
        },
      }),
      '加载更多探索流失败',
    );
  } catch (error) {
    emitRealmExploreError('load-more-explore-feed', error, { tag: normalizedTag, limit });
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
