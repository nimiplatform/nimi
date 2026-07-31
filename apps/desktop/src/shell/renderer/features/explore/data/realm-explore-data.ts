import type { Realm } from '@nimiplatform/sdk/realm';
import {
  loadNimiRealmExploreFeedItems,
} from '@nimiplatform/sdk/realm';
import type {
  RealmGetExploreFeedOperationResponse,
  RealmModel,
} from '@nimiplatform/sdk/realm/generated';
import type { DesktopRendererSdkPort } from '../../../renderer/sdk-port.js';
import type { JsonObject } from '@nimiplatform/sdk/types';
import {
  characterSourceRefKey,
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../../realm-source/realm-source-identity.js';
import {
  projectCharacterSourceProfile,
} from '../../realm-source/character-source-profile-projection.js';
import {
  requireWorldPublicSourceCardDto,
  type WorldPublicSourceCardDto,
} from '../../world/data/world-public-projection.js';

type PersonaCharacterCoreDto = RealmModel<'PersonaCharacterCoreDto'>;

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
  details?: JsonObject,
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

function failPersonaCharacterContract(reasonCode: string, message: string): never {
  const error = new Error(message) as Error & { reasonCode?: string };
  error.reasonCode = reasonCode;
  throw error;
}

function requirePersonaCharacterCore(value: unknown): {
  persona: PersonaCharacterCoreDto;
  sourceRef: Extract<CharacterSourceRefV3, { kind: 'personaCharacter' }>;
} {
  const persona = asRecord(value);
  const id = normalizeText(persona.id);
  if (!id) {
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
  const sourceRef = readCharacterSourceRefV3({
    kind: 'personaCharacter',
    id,
    worldId: normalizeText(persona.worldId),
    ownerAccountId: normalizeText(persona.ownerAccountId),
    sourceHash: normalizeText(persona.sourceHash),
  });
  if (!sourceRef || sourceRef.kind !== 'personaCharacter') {
    failPersonaCharacterContract(
      'SDK_REALM_PERSONA_CHARACTER_SOURCE_REF_INVALID',
      `PersonaCharacter ${id} cannot produce a strict CharacterSourceRefV3`,
    );
  }
  return {
    persona: value as PersonaCharacterCoreDto,
    sourceRef,
  };
}

async function loadPersonaPublicSourceCard(
  realm: Realm,
  sourceRef: Extract<CharacterSourceRefV3, { kind: 'personaCharacter' }>,
): Promise<WorldPublicSourceCardDto> {
  const source = requireWorldPublicSourceCardDto(
    await realm.worldPublic.worldPublicControllerGetCharacterSource({
      path: {},
      body: { sourceRef },
    }),
    sourceRef.worldId,
  );
  const returnedSourceRef = readCharacterSourceRefV3(source.sourceRef);
  if (!returnedSourceRef
    || characterSourceRefKey(returnedSourceRef) !== characterSourceRefKey(sourceRef)) {
    failPersonaCharacterContract(
      'SDK_REALM_PERSONA_CHARACTER_PUBLIC_SOURCE_REF_MISMATCH',
      `WorldPublicSourceCard ${source.id} does not match the requested PersonaCharacter sourceRef`,
    );
  }
  return source;
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
      const projectedItems = await Promise.all(rows.map(async (row) => {
        const { persona, sourceRef } = requirePersonaCharacterCore(row);
        const publicSource = await loadPersonaPublicSourceCard(realm, sourceRef);
        const projection = projectCharacterSourceProfile(persona.profile, publicSource);
        return {
          id: persona.id,
          displayName: projection.displayName,
          name: projection.displayName,
          handle: projection.handle || projection.displayName,
          avatarUrl: projection.avatarUrl,
          bio: projection.bio,
          tags: projection.tags,
          sourceRef,
          viewerRelation: projection.viewerRelation,
          visibility: persona.visibility,
          role: projection.characterProfile.role,
          archetype: projection.characterProfile.archetype,
          cadence: projection.characterProfile.interaction?.cadence ?? null,
          worldId: sourceRef.worldId,
          worldName: projection.worldName,
          ownership: projection.ownership,
          createdAt: persona.createdAt,
          updatedAt: persona.updatedAt,
        };
      }));
      const items = projectedItems.filter((item) => {
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

export function createRealmExploreData(sdk: DesktopRendererSdkPort) {
  const callRealmApi = sdk.socialData.callApi;
  const emitRealmDataError = sdk.socialData.emitDataError;
  return Object.freeze({
  loadExplorePersonas: (input: LoadExplorePersonasInput = {}) =>
    loadExplorePersonas(callRealmApi, emitRealmDataError, {
      ...input,
      limit: Math.min(input.limit ?? 20, 100),
    }),
  loadExploreFeed: (tag: string | null = null, limit = 20) =>
    loadExploreFeedItems(callRealmApi, emitRealmDataError, tag, Math.min(limit, 100)),
  loadMoreExploreFeed: (limit = 20, cursor?: string, tag?: string | null) =>
    loadMoreExploreFeedItems(callRealmApi, emitRealmDataError, Math.min(limit, 100), cursor, tag),
  });
}
