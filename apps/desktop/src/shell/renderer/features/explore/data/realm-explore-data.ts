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

function normalizePublicMediaUrl(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized && /^https?:\/\//iu.test(normalized) ? normalized : undefined;
}

function readExternalAssetUri(core: Record<string, unknown>, kinds: readonly string[]): string | undefined {
  const assets = asRecord(core.assets);
  const refs = Array.isArray(assets.externalRefs) ? assets.externalRefs : [];
  for (const ref of refs) {
    const record = asRecord(ref);
    const kind = normalizeText(record.kind);
    if (kind && kinds.includes(kind)) {
      const uri = normalizePublicMediaUrl(record.uri);
      if (uri) return uri;
    }
  }
  return undefined;
}

function failPersonaCharacterContract(reasonCode: string, message: string): never {
  const error = new Error(message) as Error & { reasonCode?: string };
  error.reasonCode = reasonCode;
  throw error;
}

function requirePersonaCharacterCore(value: unknown): Record<string, unknown> {
  const persona = asRecord(value);
  if (!persona.id || typeof persona.id !== 'string') {
    failPersonaCharacterContract(
      'SDK_REALM_PERSONA_CHARACTER_CORE_CONTRACT_INVALID',
      'PersonaCharacter payload is missing id',
    );
  }
  const profile = asRecord(persona.profile);
  if (Object.keys(profile).length === 0) {
    failPersonaCharacterContract(
      'SDK_REALM_PERSONA_CHARACTER_CORE_CONTRACT_INVALID',
      `PersonaCharacter ${persona.id} payload is missing profile object`,
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
      const rows = query || tag
        ? await realm.worldCore.worldCoreControllerListPersonaCharacters({
            path: {},
            query: { take: limit, visibility: 'public' },
          })
        : await realm.worldCore.worldCoreControllerDiscoverPersonaCharacters({
            path: {},
            query: { take: limit },
          });
      if (!Array.isArray(rows)) {
        failPersonaCharacterContract(
          'SDK_REALM_PERSONA_CHARACTER_CORE_LIST_CONTRACT_INVALID',
          'PersonaCharacter list payload must be an array',
        );
      }
      const normalizedQuery = query?.toLowerCase();
      const normalizedTag = tag?.toLowerCase();
      const items = rows.map((row) => {
        const persona = requirePersonaCharacterCore(row);
        const profile = asRecord(persona.profile);
        const identity = asRecord(profile.identity);
        const presentation = asRecord(profile.presentation);
        const interactionProfile = asRecord(profile.interactionProfile);
        const contentProfile = asRecord(profile.contentProfile);
        const personaStyle = asRecord(profile.personaStyle);
        const origin = asRecord(persona.origin);
        const homeWorldId = normalizeText(persona.worldId)
          ?? normalizeText(interactionProfile.homeWorldId);
        const sourceHash = normalizeText(persona.sourceHash);
        const ownerAccountId = normalizeText(persona.ownerAccountId);
        const sourceRef = homeWorldId && sourceHash && ownerAccountId
          ? {
              kind: 'personaCharacter' as const,
              id: String(persona.id),
              worldId: homeWorldId,
              ownerAccountId,
              sourceHash,
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
          avatarUrl: readExternalAssetUri(profile, ['avatar', 'referenceImage'])
            ?? null,
          bio: normalizeText(identity.summary)
            ?? normalizeText(presentation.profileLine)
            ?? normalizeText(presentation.shortBio)
            ?? null,
          tags,
          source: profile,
          sourceKind: 'personaCharacter',
          sourceId: persona.id,
          sourceHash: sourceHash ?? null,
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
    '加载 PersonaCharacter 探索失败',
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
