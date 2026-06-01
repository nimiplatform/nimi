import {
  loadRealmExploreAgents,
  loadRealmExploreFeedItems,
  type LoadRealmExploreAgentsInput,
  type RealmSocialFeedApiCaller,
  type RealmSocialFeedErrorEmitter,
} from '@nimiplatform/sdk/realm';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';

export type LoadExploreAgentsInput = LoadRealmExploreAgentsInput;

export async function loadExploreAgents(
  callApi: RealmSocialFeedApiCaller,
  emitRealmExploreError: RealmSocialFeedErrorEmitter,
  input: LoadExploreAgentsInput = {},
) {
  return loadRealmExploreAgents(callApi, emitRealmExploreError, input);
}

export async function loadExploreFeedItems(
  callApi: RealmSocialFeedApiCaller,
  emitRealmExploreError: RealmSocialFeedErrorEmitter,
  tag: string | null,
  limit: number,
) {
  return loadRealmExploreFeedItems(callApi, emitRealmExploreError, tag, limit);
}

export async function loadMoreExploreFeedItems(
  callApi: RealmSocialFeedApiCaller,
  emitRealmExploreError: RealmSocialFeedErrorEmitter,
  limit: number,
  cursor?: string,
  tag?: string | null,
) {
  if (!cursor) return undefined;
  return loadRealmExploreFeedItems(callApi, emitRealmExploreError, tag || null, limit, cursor);
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
