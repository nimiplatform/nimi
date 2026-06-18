import type { Realm } from '@nimiplatform/sdk/realm';
import {
  loadNimiRealmExploreFeedItems,
} from '@nimiplatform/sdk/realm';
import type {
  RealmGetExploreFeedOperationResponse,
} from '@nimiplatform/sdk/realm/generated';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';

export type LoadExplorePersonasInput = {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readExternalAssetUri(core: Record<string, unknown>, kinds: readonly string[]): string | undefined {
  const assets = asRecord(core.assets);
  const refs = Array.isArray(assets.externalRefs) ? assets.externalRefs : [];
  for (const ref of refs) {
    const record = asRecord(ref);
    const kind = normalizeText(record.kind);
    if (kind && kinds.includes(kind)) {
      const uri = normalizeText(record.uri);
      if (uri) return uri;
    }
  }
  return undefined;
}

function failRealmPersonaContract(reasonCode: string, message: string): never {
  const error = new Error(message) as Error & { reasonCode?: string };
  error.reasonCode = reasonCode;
  throw error;
}

function requireRealmPersonaCore(value: unknown): Record<string, unknown> {
  const persona = asRecord(value);
  if (!persona.id || typeof persona.id !== 'string') {
    failRealmPersonaContract(
      'SDK_REALM_PERSONA_CORE_CONTRACT_INVALID',
      'RealmPersona payload is missing id',
    );
  }
  const core = asRecord(persona.core);
  if (Object.keys(core).length === 0) {
    failRealmPersonaContract(
      'SDK_REALM_PERSONA_CORE_CONTRACT_INVALID',
      `RealmPersona ${persona.id} payload is missing core object`,
    );
  }
  return persona;
}

export async function loadExplorePersonas(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
  input: LoadExplorePersonasInput = {},
): Promise<RealmSourceExploreResponse> {
  const tag = normalizeText(input.tag);
  const query = normalizeText(input.query);
  const limit = input.limit ?? 20;
  return callApi(
    async (realm) => {
      void emitRealmExploreError;
      const rows = await realm.worldCore.worldCoreControllerListRealmPersonas({
        path: {},
        query: { take: limit, visibility: 'public' },
      });
      if (!Array.isArray(rows)) {
        failRealmPersonaContract(
          'SDK_REALM_PERSONA_CORE_LIST_CONTRACT_INVALID',
          'RealmPersona list payload must be an array',
        );
      }
      const normalizedQuery = query?.toLowerCase();
      const normalizedTag = tag?.toLowerCase();
      const items = rows.map((row) => {
        const persona = requireRealmPersonaCore(row);
        const core = asRecord(persona.core);
        const identity = asRecord(core.identity);
        const presentation = asRecord(core.presentation);
        const interactionProfile = asRecord(core.interactionProfile);
        const contentProfile = asRecord(core.contentProfile);
        const personaStyle = asRecord(core.personaStyle);
        const origin = asRecord(persona.origin);
        const homeWorldId = normalizeText(persona.homeWorldId)
          ?? normalizeText(interactionProfile.homeWorldId);
        const contentHash = normalizeText(persona.contentHash);
        const sourceRef = homeWorldId && contentHash
          ? {
              kind: 'realmPersona' as const,
              worldId: homeWorldId,
              sourceId: String(persona.id),
              sourceContentHash: contentHash,
            }
          : null;
        const displayName = normalizeText(presentation.displayName)
          ?? normalizeText(identity.name)
          ?? String(persona.id);
        const handle = normalizeText(identity.handle)
          ?? displayName;
        const tags = Array.isArray(contentProfile.topics)
          ? contentProfile.topics.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [];
        return {
          id: persona.id,
          displayName,
          name: displayName,
          handle,
          avatarUrl: normalizeText(presentation.avatarResourceRef)
            ?? readExternalAssetUri(core, ['avatar', 'referenceImage'])
            ?? null,
          bio: normalizeText(identity.summary)
            ?? normalizeText(presentation.profileLine)
            ?? normalizeText(presentation.shortBio)
            ?? null,
          tags,
          source: core,
          sourceKind: 'realmPersona',
          sourceId: persona.id,
          sourceContentHash: contentHash ?? null,
          sourceRef,
          runtimeSourceRef: null,
          visibility: normalizeText(persona.visibility) ?? null,
          archetype: normalizeText(personaStyle.archetype) ?? normalizeText(personaStyle.voice),
          origin: normalizeText(origin.kind),
          pacing: normalizeText(personaStyle.pacing),
          worldId: homeWorldId,
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
    '加载 RealmPersona 探索失败',
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
  loadExplorePersonas: (input: LoadExplorePersonasInput = {}) =>
    loadExplorePersonas(callRealmApi, emitRealmDataError, {
      ...input,
      limit: Math.min(input.limit ?? 20, 100),
    }),
  loadExploreFeed: (tag: string | null = null, limit = 20) =>
    loadExploreFeedItems(callRealmApi, emitRealmDataError, tag, Math.min(limit, 100)),
  loadMoreExploreFeed: (limit = 20, cursor?: string, tag?: string | null) =>
    loadMoreExploreFeedItems(callRealmApi, emitRealmDataError, Math.min(limit, 100), cursor, tag),
};
