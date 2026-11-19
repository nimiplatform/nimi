import { asRecord, buildWorldPublicAssets, buildWorldPublicHistoryItems, buildWorldPublicScenes, buildWorldPublicSemanticBundle } from './data/world-public-projection.js';
import type { RealmWorldData } from './data/realm-world-data.js';
import type {
  WorldAssetExternalRef,
  WorldCharacter,
  WorldHistoryBundle,
  WorldPublicAssetsData,
  WorldSemanticData,
} from './world-detail-types.js';
import { toWorldListItem, type WorldListItem } from './world-list-model.js';
import { readStringValue } from './world-detail-query-readers.js';
import { toWorldDisplayHistoryBundle } from './world-detail-history-projection.js';
import {
  projectWorldPrimaryDisplayDetail,
  toWorldDisplayCharacter,
  toWorldDisplayFallback as projectWorldDisplayFallback,
} from './world-detail-primary-projection.js';
import { toWorldPublicAssetsData } from './world-detail-public-assets-projection.js';
import { toWorldDisplaySemanticBundle } from './world-detail-semantic-projection.js';
import type {
  WorldDisplayDetail,
  WorldPrimaryDetailRecord,
  WorldPrimaryDisplayDetail,
} from './world-detail-query-types.js';
export type {
  WorldDisplayDetail,
  WorldPrimaryDisplayDetail,
} from './world-detail-query-types.js';

const DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT = 4;
const WORLD_RECOMMENDED_CHARACTER_PREVIEW_LIMIT = 3;

const EMPTY_WORLD_HISTORY: WorldHistoryBundle = {
  items: [],
  summary: null,
};

const EMPTY_WORLD_SEMANTIC: WorldSemanticData = {
  operationTitle: null,
  operationDescription: null,
  operationRules: [],
  powerSystems: [],
  standaloneLevels: [],
  taboos: [],
  topology: null,
  causality: null,
  languages: [],
  worldviewEvents: [],
  worldviewSnapshots: [],
  hasContent: false,
};

const EMPTY_WORLD_PUBLIC_ASSETS: WorldPublicAssetsData = {
  resourceRefs: [],
  externalRefs: [],
  intents: [],
  scenes: [],
};

export function worldPublicHighlightRefs(publicAssets: WorldPublicAssetsData): WorldAssetExternalRef[] {
  return publicAssets.externalRefs
    .filter((ref) => ref.kind === 'highlight' || ref.kind.startsWith('highlight-'))
    .map((ref) => ({ ...ref, uri: readStringValue(ref.uri) }))
    .filter((ref) => Boolean(ref.uri));
}

export function worldPublicHighlightImages(publicAssets: WorldPublicAssetsData): string[] {
  return worldPublicHighlightRefs(publicAssets).map((ref) => ref.uri);
}

function normalizeWorldId(worldId: string): string {
  return String(worldId || '').trim();
}

export function toWorldDisplayFallback(world: WorldListItem) {
  return projectWorldDisplayFallback(world);
}

// Memory-only catalog pages are keyed by contract version, Realm target and server query; they
// never share a key with another query or Realm and are not persisted as offline results.
export const WORLD_CATALOG_CONTRACT_VERSION = 'realm-world-catalog/v4-cover';

export function worldCatalogQueryKey(realmBaseUrl: string, query: string, filters: { topicId?: string; genre?: string; theme?: string } = {}) {
  return ['world-catalog', WORLD_CATALOG_CONTRACT_VERSION, realmBaseUrl, query.trim(), filters.topicId ?? null, filters.genre ?? null, filters.theme ?? null] as const;
}

export type WorldCatalogPage = {
  items: WorldListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
};

export async function fetchWorldCatalogPage(
  realmWorldData: RealmWorldData,
  query: string,
  cursor: string | null,
  filters: { topicId?: string; genre?: string; theme?: string } = {},
): Promise<WorldCatalogPage> {
  const page = await realmWorldData.loadWorldCatalogPage({ q: query, cursor, ...filters });
  return { ...page, items: page.items.map((world) => toWorldListItem(world)) };
}

export function worldDisplayDetailQueryKey(realmBaseUrl: string, worldId: string) {
  return [
    'world-display-detail',
    WORLD_CATALOG_CONTRACT_VERSION,
    realmBaseUrl,
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT,
  ] as const;
}

export function worldRecommendedCharacterPreviewQueryKey(worldId: string) {
  return [
    'world-recommended-character-preview',
    normalizeWorldId(worldId),
    WORLD_RECOMMENDED_CHARACTER_PREVIEW_LIMIT,
  ] as const;
}

export async function fetchWorldDetailWithCharacters(
  worldId: string,
  realmWorldData: RealmWorldData,
): Promise<WorldPrimaryDetailRecord> {
  const detail = await realmWorldData.loadWorldDetailWithCharacters(
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT,
  );
  if (!detail) {
    throw new Error('WORLD_DETAIL_NOT_FOUND');
  }
  return detail;
}

export async function fetchWorldRecommendedCharacterPreview(
  worldId: string,
  worldCreatedAt: string,
  realmWorldData: RealmWorldData,
): Promise<WorldCharacter[]> {
  const page = await realmWorldData.loadWorldCharacterPage(normalizeWorldId(worldId), {
    limit: WORLD_RECOMMENDED_CHARACTER_PREVIEW_LIMIT,
  });
  return page.items.map((character) => toWorldDisplayCharacter(character, worldCreatedAt));
}

export async function fetchWorldPublicAssets(worldId: string, realmWorldData: RealmWorldData): Promise<WorldPublicAssetsData> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [assetsPayload, scenesPayload] = await Promise.all([
    realmWorldData.loadWorldAssets(normalizedWorldId),
    realmWorldData.loadWorldScenes(normalizedWorldId),
  ]);
  return toWorldPublicAssetsData(assetsPayload, scenesPayload);
}

export async function fetchWorldPrimaryDisplayDetail(worldId: string, realmWorldData: RealmWorldData): Promise<WorldPrimaryDisplayDetail> {
  const primary = await fetchWorldDetailWithCharacters(worldId, realmWorldData);
  return projectWorldPrimaryDisplayDetail(primary);
}

// A malformed optional section can be retried without hiding the rest of the world.
function projectSection<T>(read: () => T, empty: T) {
  try {
    return { value: read(), status: 'success' as const };
  } catch {
    return { value: empty, status: 'error' as const };
  }
}

export async function fetchWorldDisplayDetail(worldId: string, data: RealmWorldData): Promise<WorldDisplayDetail> {
  const display = await fetchWorldPrimaryDisplayDetail(worldId, data);
  const record = asRecord(display.primary);
  const history = projectSection(() => toWorldDisplayHistoryBundle(buildWorldPublicHistoryItems(record)), EMPTY_WORLD_HISTORY);
  const semantic = projectSection(() => toWorldDisplaySemanticBundle(buildWorldPublicSemanticBundle(record)), EMPTY_WORLD_SEMANTIC);
  const assets = projectSection(() => toWorldPublicAssetsData(buildWorldPublicAssets(record), buildWorldPublicScenes(record)), EMPTY_WORLD_PUBLIC_ASSETS);
  return { ...display, history: history.value, semantic: semantic.value, publicAssets: assets.value, audits: [],
    sections: { history: history.status, semantic: semantic.status, publicAssets: assets.status, audits: 'success' } };
}
