import type { Realm } from '@nimiplatform/sdk/realm';
import {
  loadNimiRealmExploreFeedItems,
} from '@nimiplatform/sdk/realm';
import type { RealmGetExploreFeedOperationResponse } from '@nimiplatform/sdk/realm/generated';
import type { DesktopRendererSdkPort } from '../../../renderer/sdk-port.js';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { readCharacterSourceRefV3 } from '../../realm-source/realm-source-identity.js';
import {
  projectWorldPublicSourceCard,
  requireWorldPublicSourceCardDto,
} from '../../world/data/world-public-projection.js';

export type LoadExplorePersonasInput = {
  tag?: string | null;
  query?: string | null;
  cursor?: string | null;
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
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
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

// Public Persona discovery reads the server-side paginated catalog: a search term never switches
// to the viewer's owned list, and every page is filtered by Realm before it arrives.
export async function loadExplorePersonas(
  callApi: RealmExploreApiCaller,
  emitRealmExploreError: RealmExploreErrorEmitter,
  input: LoadExplorePersonasInput = {},
): Promise<RealmSourceExploreResponse> {
  const q = normalizeText(input.query) ?? normalizeText(input.tag);
  const limit = input.limit ?? 20;
  return callApi(
    async (realm) => {
      void emitRealmExploreError;
      const page = asRecord(await realm.worldPublic.worldPublicControllerListPersonaCharacterCatalog({
        path: {},
        query: {
          ...(q ? { q } : {}),
          ...(input.cursor ? { cursor: input.cursor } : {}),
          limit,
        },
      }));
      const rows = page.items;
      const nextCursor = page.nextCursor;
      if (
        !Array.isArray(rows)
        || (nextCursor !== null && typeof nextCursor !== 'string')
        || typeof page.hasMore !== 'boolean'
        || page.hasMore !== (nextCursor !== null)
        || typeof page.totalCount !== 'number'
      ) {
        failPersonaCharacterContract(
          'SDK_REALM_PERSONA_CHARACTER_CATALOG_CONTRACT_INVALID',
          'PersonaCharacter catalog page must carry items, nextCursor, hasMore and totalCount',
        );
      }
      const items = rows.map((row) => {
        const card = requireWorldPublicSourceCardDto(row, String(asRecord(row).worldId || ''));
        const sourceRef = readCharacterSourceRefV3(card.sourceRef);
        if (!sourceRef || sourceRef.kind !== 'personaCharacter') {
          failPersonaCharacterContract(
            'SDK_REALM_PERSONA_CHARACTER_PUBLIC_SOURCE_REF_MISMATCH',
            `PersonaCharacter catalog card ${card.id} requires a PersonaCharacter sourceRef`,
          );
        }
        const projected = projectWorldPublicSourceCard(card);
        return {
          id: card.id,
          displayName: card.displayName,
          name: card.displayName,
          handle: card.handle || card.displayName,
          avatarUrl: projected.avatarUrl ?? null,
          bio: card.summary,
          tags: [...card.traits, ...card.topics],
          sourceRef,
          viewerRelation: card.relation,
          visibility: 'public',
          role: card.role ?? null,
          archetype: card.role ?? null,
          cadence: null,
          worldId: sourceRef.worldId,
          worldName: card.worldName,
          ownership: card.ownership,
          createdAt: card.updatedAt,
          updatedAt: card.updatedAt,
        };
      });
      return { items, nextCursor, hasMore: page.hasMore, totalCount: page.totalCount };
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
