import type { Realm } from '@nimiplatform/sdk/realm';
import {
  loadNimiRealmExploreFeedItems,
} from '@nimiplatform/sdk/realm';
import type {
  RealmGetExploreFeedOperationResponse,
} from '@nimiplatform/sdk/realm/generated';
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

export type RealmSourceExploreResponse = {
  items: Array<Record<string, unknown>>;
};

function normalizeText(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

export async function loadExploreAgents(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
  input: LoadExploreAgentsInput = {},
): Promise<RealmSourceExploreResponse> {
  const tag = normalizeText(input.tag);
  const query = normalizeText(input.query);
  const limit = input.limit ?? 20;
  return callApi(
    async (realm) => {
      void emitRealmExploreError;
      const rows = await realm.worldCore.worldCoreControllerListRealmPersonas({
        path: {},
        query: { limit },
      });
      const normalizedQuery = query?.toLowerCase();
      const normalizedTag = tag?.toLowerCase();
      const items = rows.map((persona) => {
        const core = persona.core && typeof persona.core === 'object' && !Array.isArray(persona.core)
          ? persona.core as Record<string, unknown>
          : {};
        const displayName = normalizeText(core.displayName) ?? normalizeText(core.name) ?? persona.id;
        const handle = normalizeText(core.handle) ?? displayName;
        return {
          ...core,
          id: persona.id,
          displayName,
          name: displayName,
          handle,
          avatarUrl: normalizeText(core.avatarUrl) ?? null,
          bio: normalizeText(core.bio) ?? normalizeText(core.description) ?? null,
          tags: Array.isArray(core.tags) ? core.tags : [],
          agentProfile: core,
          sourceKind: 'realmPersona',
          worldId: persona.homeWorldId,
          createdAt: persona.createdAt,
          updatedAt: persona.updatedAt,
        };
      }).filter((item) => {
        const haystack = [
          item.id,
          item.displayName,
          item.handle,
          item.bio,
          ...(Array.isArray(item.tags) ? item.tags : []),
        ].join(' ').toLowerCase();
        return (!normalizedQuery || haystack.includes(normalizedQuery))
          && (!normalizedTag || haystack.includes(normalizedTag));
      });
      return { items };
    },
    '加载探索 Agent 失败',
  );
}

export async function loadExploreFeedItems(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
  tag: string | null,
  limit: number,
): Promise<RealmGetExploreFeedOperationResponse> {
  const normalizedTag = normalizeText(tag);
  return callApi(
    (realm) => loadNimiRealmExploreFeedItems(realm, emitRealmExploreError, normalizedTag ?? null, limit),
    '加载探索流失败',
  );
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
  return callApi(
    (realm) => loadNimiRealmExploreFeedItems(realm, emitRealmExploreError, normalizedTag ?? null, limit, cursor),
    '加载更多探索流失败',
  );
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
