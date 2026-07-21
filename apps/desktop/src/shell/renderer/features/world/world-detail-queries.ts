import type { RealmWorldData } from './data/realm-world-data.js';
import type { WorldAssetExternalRef, WorldHistoryBundle, WorldPublicAssetsData, WorldSemanticData } from './world-detail-types.js';
import { toWorldListItem, type WorldListItem } from './world-list-model.js';
import { readStringValue } from './world-detail-query-readers.js';
import { toWorldDisplayHistoryBundle } from './world-detail-history-projection.js';
import {
  projectWorldPrimaryDisplayDetail,
  toWorldDisplayFallback as projectWorldDisplayFallback,
} from './world-detail-primary-projection.js';
import { toWorldPublicAssetsData } from './world-detail-public-assets-projection.js';
import { toWorldDisplaySemanticBundle } from './world-detail-semantic-projection.js';
import type {
  WorldDisplayDetail,
  WorldPrimaryDetailRecord,
  WorldPrimaryDisplayDetail,
  WorldSupplementalDisplayDetail,
} from './world-detail-query-types.js';
export type {
  WorldDisplayDetail,
  WorldPrimaryDisplayDetail,
  WorldSupplementalDisplayDetail,
} from './world-detail-query-types.js';

const DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT = 4;

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

export function worldListQueryKey() {
  return ['worlds-list'] as const;
}

export async function fetchWorldListItems(
  realmWorldData: RealmWorldData,
  status?: WorldListItem['status'],
): Promise<WorldListItem[]> {
  const worlds = await realmWorldData.loadWorlds(status as Parameters<typeof realmWorldData.loadWorlds>[0]);
  return worlds.map((world) => toWorldListItem(world));
}

export function worldDisplayDetailQueryKey(worldId: string) {
  return [
    'world-display-detail',
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT,
  ] as const;
}

export function worldPrimaryDisplayDetailQueryKey(worldId: string) {
  return [
    'world-primary-display-detail',
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_CHARACTER_LIMIT,
  ] as const;
}

export function worldSupplementalDisplayDetailQueryKey(worldId: string) {
  return ['world-supplemental-display-detail', normalizeWorldId(worldId)] as const;
}

export function worldHistoryQueryKey(worldId: string) {
  return ['world-history', normalizeWorldId(worldId)] as const;
}

export function worldSemanticBundleQueryKey(worldId: string) {
  return ['world-semantic-bundle', normalizeWorldId(worldId)] as const;
}

export function worldPublicAssetsQueryKey(worldId: string) {
  return ['world-public-assets', normalizeWorldId(worldId)] as const;
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

export async function fetchWorldHistory(worldId: string, realmWorldData: RealmWorldData): Promise<WorldHistoryBundle> {
  const payload = await realmWorldData.loadWorldHistory(normalizeWorldId(worldId));
  return toWorldDisplayHistoryBundle(payload);
}

export async function fetchWorldSemanticBundle(worldId: string, realmWorldData: RealmWorldData): Promise<WorldSemanticData> {
  const payload = await realmWorldData.loadWorldSemanticBundle(normalizeWorldId(worldId));
  return toWorldDisplaySemanticBundle(payload);
}

export async function fetchWorldPublicAssets(worldId: string, realmWorldData: RealmWorldData): Promise<WorldPublicAssetsData> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [assetsPayload, scenesPayload] = await Promise.all([
    realmWorldData.loadWorldAssets(normalizedWorldId),
    realmWorldData.loadWorldScenes(normalizedWorldId),
  ]);
  return toWorldPublicAssetsData(assetsPayload, scenesPayload);
}

export function toWorldPrimaryDisplayDetail(display: WorldDisplayDetail): WorldPrimaryDisplayDetail {
  return {
    primary: display.primary,
    world: display.world,
    characters: display.characters,
  };
}

export function toWorldSupplementalDisplayDetail(display: WorldDisplayDetail): WorldSupplementalDisplayDetail {
  return {
    history: display.history,
    semantic: display.semantic,
    audits: display.audits,
    publicAssets: display.publicAssets,
    sections: display.sections,
  };
}

export function mergeWorldDisplayDetail(
  primary: WorldPrimaryDisplayDetail,
  supplemental: WorldSupplementalDisplayDetail,
): WorldDisplayDetail {
  return {
    ...primary,
    history: supplemental.history,
    semantic: supplemental.semantic,
    audits: supplemental.audits,
    publicAssets: supplemental.publicAssets,
    sections: supplemental.sections,
  };
}

export async function fetchWorldPrimaryDisplayDetail(worldId: string, realmWorldData: RealmWorldData): Promise<WorldPrimaryDisplayDetail> {
  const primary = await fetchWorldDetailWithCharacters(worldId, realmWorldData);
  return projectWorldPrimaryDisplayDetail(primary);
}

export async function fetchWorldSupplementalDisplayDetail(worldId: string, realmWorldData: RealmWorldData): Promise<WorldSupplementalDisplayDetail> {
  const [historyResult, semanticResult, publicAssetsResult] = await Promise.allSettled([
    fetchWorldHistory(worldId, realmWorldData),
    fetchWorldSemanticBundle(worldId, realmWorldData),
    fetchWorldPublicAssets(worldId, realmWorldData),
  ]);
  return {
    history: historyResult.status === 'fulfilled' ? historyResult.value : EMPTY_WORLD_HISTORY,
    semantic: semanticResult.status === 'fulfilled' ? semanticResult.value : EMPTY_WORLD_SEMANTIC,
    audits: [],
    publicAssets: publicAssetsResult.status === 'fulfilled' ? publicAssetsResult.value : EMPTY_WORLD_PUBLIC_ASSETS,
    sections: {
      history: historyResult.status === 'fulfilled' ? 'success' : 'error',
      semantic: semanticResult.status === 'fulfilled' ? 'success' : 'error',
      audits: 'success',
      publicAssets: publicAssetsResult.status === 'fulfilled' ? 'success' : 'error',
    },
  };
}

export async function fetchWorldDisplayDetail(worldId: string, realmWorldData: RealmWorldData): Promise<WorldDisplayDetail> {
  const primary = await fetchWorldPrimaryDisplayDetail(worldId, realmWorldData);
  const supplemental = await fetchWorldSupplementalDisplayDetail(worldId, realmWorldData);
  return mergeWorldDisplayDetail(primary, supplemental);
}
