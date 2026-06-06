import type { RealmTypedCallOptions } from '../core-generated/realm-typed-client';
import type { JsonObject } from '../types';
import {
  readString,
  requireRecord,
  requireRecordArray,
  requireWorldError,
} from './world-data-primitives';
import type {
  NimiRealmWorldAgentSummary,
  NimiRealmWorldApi,
  NimiRealmWorldBindingListPayload,
  NimiRealmWorldDetail,
  NimiRealmWorldDetailWithAgents,
  NimiRealmWorldHistoryPayload,
  NimiRealmWorldLevelAuditEvent,
  NimiRealmWorldLorebookListPayload,
  NimiRealmWorldSceneListPayload,
  NimiRealmWorldSemanticBundle,
  NimiRealmWorldStatus,
  NimiRealmWorldviewDetail,
} from './world-data-types';

export * from './world-data-display';
export {
  normalizeNimiRealmWorldTruthAnchor,
  normalizeNimiRealmWorldTruthDetail,
  normalizeNimiRealmWorldTruthListItem,
  normalizeNimiRealmWorldTruthSummary,
} from './world-data-truth';
export * from './world-data-types';

function normalizeNimiRealmWorldId(worldId: string): string {
  const normalized = String(worldId || '').trim();
  if (!normalized) {
    requireWorldError('SDK_REALM_WORLD_ID_REQUIRED', 'worldId is required.', 'provide_world_id');
  }
  return normalized;
}

function assertMatchingWorldField(
  record: JsonObject,
  field: string,
  expectedWorldId: string,
  reasonCode: string,
): void {
  const actualWorldId = readString(record, [field]);
  if (!actualWorldId || actualWorldId !== expectedWorldId) {
    requireWorldError(
      reasonCode,
      `Realm world response ${field} does not match requested worldId.`,
      'check_realm_world_response',
      { expectedWorldId, actualWorldId },
    );
  }
}

function normalizeRecommendedAgentLimit(recommendedAgentLimit?: number): number | undefined {
  return Number.isFinite(recommendedAgentLimit) && (recommendedAgentLimit ?? 0) > 0
    ? Math.min(Math.floor(recommendedAgentLimit ?? 0), 12)
    : undefined;
}

export function buildNimiRealmWorldDetailWithAgentsCacheKey(
  worldId: string,
  recommendedAgentLimit?: number,
): string {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const normalizedRecommendedAgentLimit = normalizeRecommendedAgentLimit(recommendedAgentLimit);
  return normalizedRecommendedAgentLimit
    ? `world:${normalizedWorldId}:detail:recommended-agents:${normalizedRecommendedAgentLimit}`
    : `world:${normalizedWorldId}:detail`;
}

export async function loadNimiRealmWorldList(
  realm: NimiRealmWorldApi,
  status?: NimiRealmWorldStatus,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldDetail[]> {
  const payload = await realm.world.worldControllerListWorlds({
    path: {},
    query: status === undefined ? {} : { status },
  }, options);
  return requireRecordArray(payload, 'SDK_REALM_WORLD_LIST_CONTRACT_INVALID') as NimiRealmWorldDetail[];
}

export async function loadNimiRealmMainWorld(
  realm: NimiRealmWorldApi,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldDetail> {
  const payload = await realm.world.worldControllerGetMainWorld({ path: {} }, options);
  return requireRecord(payload, 'SDK_REALM_MAIN_WORLD_CONTRACT_INVALID') as NimiRealmWorldDetail;
}

export async function loadNimiRealmWorldLevelAudits(
  realm: NimiRealmWorldApi,
  worldId: string,
  limit = 20,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldLevelAuditEvent[]> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;
  const payload = await realm.world.worldControllerGetWorldLevelAudits({
    path: { id: normalizedWorldId },
    query: { limit: normalizedLimit },
  }, options);
  return requireRecordArray(payload, 'SDK_REALM_WORLD_LEVEL_AUDITS_CONTRACT_INVALID') as NimiRealmWorldLevelAuditEvent[];
}

export async function loadNimiRealmWorldDetailById(
  realm: NimiRealmWorldApi,
  worldId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldDetail | null> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const payload = await realm.world.worldControllerGetWorld({ path: { id: normalizedWorldId } }, options);
  if (payload == null) {
    return null;
  }
  const record = requireRecord(payload, 'SDK_REALM_WORLD_DETAIL_CONTRACT_INVALID');
  assertMatchingWorldField(record, 'id', normalizedWorldId, 'SDK_REALM_WORLD_DETAIL_WORLD_ID_MISMATCH');
  return record as NimiRealmWorldDetail;
}

export async function loadNimiRealmWorldHistory(
  realm: NimiRealmWorldApi,
  worldId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldHistoryPayload> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const payload = await realm.world.worldControllerGetWorldHistory({ path: { id: normalizedWorldId } }, options);
  const record = requireRecord(payload, 'SDK_REALM_WORLD_HISTORY_CONTRACT_INVALID');
  assertMatchingWorldField(record, 'worldId', normalizedWorldId, 'SDK_REALM_WORLD_HISTORY_WORLD_ID_MISMATCH');
  return record as NimiRealmWorldHistoryPayload;
}

export async function loadNimiRealmWorldLorebooks(
  realm: NimiRealmWorldApi,
  worldId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldLorebookListPayload> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const payload = await realm.world.worldControllerGetWorldLorebooks({ path: { id: normalizedWorldId } }, options);
  const record = requireRecord(payload, 'SDK_REALM_WORLD_LOREBOOKS_CONTRACT_INVALID');
  assertMatchingWorldField(record, 'worldId', normalizedWorldId, 'SDK_REALM_WORLD_LOREBOOKS_WORLD_ID_MISMATCH');
  if (!Array.isArray(record.items)) {
    requireWorldError('SDK_REALM_WORLD_LOREBOOKS_CONTRACT_INVALID', 'World lorebooks payload has no items array.', 'check_realm_world_response');
  }
  return record as NimiRealmWorldLorebookListPayload;
}

export async function loadNimiRealmWorldBindings(
  realm: NimiRealmWorldApi,
  worldId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldBindingListPayload> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const payload = await realm.world.worldControllerGetWorldBindings({ path: { id: normalizedWorldId } }, options);
  const record = requireRecord(payload, 'SDK_REALM_WORLD_BINDINGS_CONTRACT_INVALID');
  assertMatchingWorldField(record, 'worldId', normalizedWorldId, 'SDK_REALM_WORLD_BINDINGS_WORLD_ID_MISMATCH');
  if (!Array.isArray(record.items)) {
    requireWorldError('SDK_REALM_WORLD_BINDINGS_CONTRACT_INVALID', 'World bindings payload has no items array.', 'check_realm_world_response');
  }
  return record as NimiRealmWorldBindingListPayload;
}

export async function loadNimiRealmWorldScenes(
  realm: NimiRealmWorldApi,
  worldId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldSceneListPayload> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const payload = await realm.world.getWorldScenes({ path: { id: normalizedWorldId } }, options);
  const record = requireRecord(payload, 'SDK_REALM_WORLD_SCENES_CONTRACT_INVALID');
  assertMatchingWorldField(record, 'worldId', normalizedWorldId, 'SDK_REALM_WORLD_SCENES_WORLD_ID_MISMATCH');
  if (!Array.isArray(record.items)) {
    requireWorldError('SDK_REALM_WORLD_SCENES_CONTRACT_INVALID', 'World scenes payload has no items array.', 'check_realm_world_response');
  }
  return record as NimiRealmWorldSceneListPayload;
}

export async function loadNimiRealmWorldAgents(
  realm: NimiRealmWorldApi,
  worldId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldAgentSummary[]> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const payload = await realm.world.worldControllerGetWorldAgents({ path: { id: normalizedWorldId } }, options);
  return requireRecordArray(payload, 'SDK_REALM_WORLD_AGENTS_CONTRACT_INVALID') as NimiRealmWorldAgentSummary[];
}

export async function loadNimiRealmWorldDetailWithAgents(
  realm: NimiRealmWorldApi,
  worldId: string,
  recommendedAgentLimit?: number,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldDetailWithAgents | null> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const normalizedRecommendedAgentLimit = normalizeRecommendedAgentLimit(recommendedAgentLimit);
  const payload = await realm.world.worldControllerGetWorldDetailWithAgents({
    path: { id: normalizedWorldId },
    query: normalizedRecommendedAgentLimit === undefined
      ? {}
      : { recommendedAgentLimit: normalizedRecommendedAgentLimit },
  }, options);
  if (payload == null) {
    return null;
  }
  const record = requireRecord(payload, 'SDK_REALM_WORLD_DETAIL_WITH_AGENTS_CONTRACT_INVALID');
  assertMatchingWorldField(record, 'id', normalizedWorldId, 'SDK_REALM_WORLD_DETAIL_WITH_AGENTS_WORLD_ID_MISMATCH');
  return record as NimiRealmWorldDetailWithAgents;
}

export async function loadNimiRealmWorldSemanticBundle(
  realm: NimiRealmWorldApi,
  worldId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmWorldSemanticBundle> {
  const normalizedWorldId = normalizeNimiRealmWorldId(worldId);
  const worldview = await realm.world.worldControllerGetWorldview({ path: { id: normalizedWorldId } }, options);
  return {
    world: null,
    worldview: requireRecord(worldview, 'SDK_REALM_WORLDVIEW_CONTRACT_INVALID') as NimiRealmWorldviewDetail,
    worldviewEvents: [],
    worldviewSnapshots: [],
  };
}
