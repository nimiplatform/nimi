import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createWorldFacade,
  mergeWorldPrimaryDetailTruth,
  normalizeWorldTruthDetail,
  toWorldDisplayAgent,
  toWorldDisplayAuditItem,
  toWorldDisplayBindingItem,
  toWorldDisplayData,
  toWorldDisplayFallback as toSdkWorldDisplayFallback,
  toWorldDisplayHistoryBundle,
  toWorldDisplayLorebookItem,
  toWorldDisplaySceneItem,
  toWorldDisplaySemanticBundle,
  type WorldTruthListItem,
  type WorldTruthDetail,
} from '@nimiplatform/sdk/world';
import { realmWorldData } from './data/realm-world-data';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type {
  WorldAgent,
  WorldAuditItem,
  WorldDetailData,
  WorldHistoryBundle,
  WorldPublicAssetsData,
  WorldSceneItem,
  WorldSemanticData,
} from './world-detail-types';
import type { WorldListItem } from './world-list-model';
type WorldDetailWithAgentsResponse = Awaited<ReturnType<typeof realmWorldData.loadWorldDetailWithAgents>>;
type WorldDetailWithAgentsDto = NonNullable<WorldDetailWithAgentsResponse>;
export type WorldPrimaryDetailRecord = WorldDetailWithAgentsDto & {
  worldTruth: WorldTruthDetail;
};
export type WorldDisplayDetail = {
  primary: WorldPrimaryDetailRecord;
  world: WorldDetailData;
  agents: WorldAgent[];
  history: WorldHistoryBundle;
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  sections: {
    history: 'success' | 'error';
    semantic: 'success' | 'error';
    audits: 'success' | 'error';
    publicAssets: 'success' | 'error';
  };
};
const DEFAULT_WORLD_PREFETCH_STALE_TIME_MS = 30_000;
const DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT = 4;
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
  lorebooks: [],
  scenes: [],
  bindings: [],
};
function normalizeWorldId(worldId: string): string {
  return String(worldId || '').trim();
}
export function toWorldDisplayFallback(world: WorldListItem): WorldDetailData {
  return toSdkWorldDisplayFallback(world);
}
export function worldListQueryKey() {
  return ['worlds-list'] as const;
}
export async function fetchWorldListItems(
  status?: WorldTruthListItem['status'],
): Promise<WorldTruthListItem[]> {
  return createWorldFacade(getPlatformClient()).truth.list(status);
}
export function worldDisplayDetailQueryKey(worldId: string) {
  return [
    'world-display-detail',
    normalizeWorldId(worldId),
    DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT,
  ] as const;
}
export function worldHistoryQueryKey(worldId: string) {
  return ['world-history', normalizeWorldId(worldId)] as const;
}
export function worldSemanticBundleQueryKey(worldId: string) {
  return ['world-semantic-bundle', normalizeWorldId(worldId)] as const;
}
export function worldLevelAuditsQueryKey(worldId: string) {
  return ['world-level-audits', normalizeWorldId(worldId)] as const;
}
export function worldPublicAssetsQueryKey(worldId: string) {
  return ['world-public-assets', normalizeWorldId(worldId)] as const;
}
export async function fetchWorldDetailWithAgents(worldId: string): Promise<WorldPrimaryDetailRecord> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [detailResponse, worldview] = await Promise.all([
    realmWorldData.loadWorldDetailWithAgents(
      normalizedWorldId,
      DEFAULT_WORLD_DETAIL_RECOMMENDED_AGENT_LIMIT,
    ),
    getPlatformClient().domains.world.getWorldview(normalizedWorldId),
  ]);
  if (!detailResponse) {
    throw new Error('WORLD_DETAIL_NOT_FOUND');
  }
  const detail = detailResponse;
  const worldTruth = normalizeWorldTruthDetail({ detail, worldview });
  if (!worldTruth) {
    throw new Error('WORLD_DETAIL_WORLD_TRUTH_INVALID');
  }
  // SDK truth owns the normalized truth-bearing fields; Desktop keeps only the
  // bounded supplement the current primary lane still needs.
  return mergeWorldPrimaryDetailTruth(detail, worldTruth);
}
export async function fetchWorldHistory(worldId: string): Promise<WorldHistoryBundle> {
  const payload = await realmWorldData.loadWorldHistory(normalizeWorldId(worldId));
  return toWorldDisplayHistoryBundle(payload);
}
export async function fetchWorldSemanticBundle(worldId: string): Promise<WorldSemanticData> {
  const payload = await realmWorldData.loadWorldSemanticBundle(normalizeWorldId(worldId));
  return toWorldDisplaySemanticBundle(payload);
}
export async function fetchWorldLevelAudits(worldId: string): Promise<WorldAuditItem[]> {
  const payload = await realmWorldData.loadWorldLevelAudits(normalizeWorldId(worldId), 20);
  return payload.map(toWorldDisplayAuditItem);
}
export async function fetchWorldPublicAssets(worldId: string): Promise<WorldPublicAssetsData> {
  const normalizedWorldId = normalizeWorldId(worldId);
  const [lorebooksPayload, bindingsPayload, scenesPayload] = await Promise.all([
    realmWorldData.loadWorldLorebooks(normalizedWorldId),
    realmWorldData.loadWorldBindings(normalizedWorldId),
    realmWorldData.loadWorldScenes(normalizedWorldId),
  ]);
  return {
    lorebooks: lorebooksPayload.items.map(toWorldDisplayLorebookItem),
    scenes: scenesPayload.items.map(toWorldDisplaySceneItem) as WorldSceneItem[],
    bindings: bindingsPayload.items.map(toWorldDisplayBindingItem),
  };
}
export async function fetchWorldDisplayDetail(worldId: string): Promise<WorldDisplayDetail> {
  const primary = await fetchWorldDetailWithAgents(worldId);
  const world = toWorldDisplayData(primary);
  const agentRecords = Array.isArray(primary.agents) ? (primary.agents as Array<Record<string, unknown>>) : [];
  const agents = agentRecords.map((agent) => toWorldDisplayAgent(agent, world.createdAt));
  const [historyResult, semanticResult, auditsResult, publicAssetsResult] = await Promise.allSettled([
    fetchWorldHistory(worldId),
    fetchWorldSemanticBundle(worldId),
    fetchWorldLevelAudits(worldId),
    fetchWorldPublicAssets(worldId),
  ]);
  return {
    primary,
    world,
    agents,
    history: historyResult.status === 'fulfilled' ? historyResult.value : EMPTY_WORLD_HISTORY,
    semantic: semanticResult.status === 'fulfilled' ? semanticResult.value : EMPTY_WORLD_SEMANTIC,
    audits: auditsResult.status === 'fulfilled' ? auditsResult.value : [],
    publicAssets: publicAssetsResult.status === 'fulfilled' ? publicAssetsResult.value : EMPTY_WORLD_PUBLIC_ASSETS,
    sections: {
      history: historyResult.status === 'fulfilled' ? 'success' : 'error',
      semantic: semanticResult.status === 'fulfilled' ? 'success' : 'error',
      audits: auditsResult.status === 'fulfilled' ? 'success' : 'error',
      publicAssets: publicAssetsResult.status === 'fulfilled' ? 'success' : 'error',
    },
  };
}
export function prefetchWorldDetailAndHistory(worldId: string): void {
  const normalizedWorldId = normalizeWorldId(worldId);
  if (!normalizedWorldId) {
    return;
  }
  void queryClient.prefetchQuery({
    queryKey: worldDisplayDetailQueryKey(normalizedWorldId),
    queryFn: () => fetchWorldDisplayDetail(normalizedWorldId),
    staleTime: DEFAULT_WORLD_PREFETCH_STALE_TIME_MS,
  });
}
