import type { Realm } from '@nimiplatform/sdk/realm';
import {
  abandonTransitById,
  completeTransitById,
  createTransit,
  fetchActiveTransit,
  fetchSceneQuota,
  fetchTransitById,
  listTransits,
} from '../clients/transit-client';

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type TransitType = 'INBOUND' | 'OUTBOUND' | 'RETURN';
export type TransitStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
export type SceneQuotaTier = 'FREE' | 'PRO' | 'MAX';

export type TransitContextDto = {
  reason?: string;
  handoffRefs?: Record<string, unknown>;
  memoryRefIds?: string[];
  stateRecordIds?: string[];
};

export type TransitDetailDto = {
  id: string;
  userId: string;
  agentId: string;
  fromWorldId: string | null;
  toWorldId: string;
  transitType: TransitType;
  status: TransitStatus;
  departedAt: string;
  arrivedAt: string | null;
  context: TransitContextDto | null;
  createdAt: string;
};

export type SceneQuotaDto = {
  used: number;
  quota: number;
  tier: SceneQuotaTier;
};

type StartWorldTransitInput = {
  agentId: string;
  fromWorldId?: string;
  toWorldId: string;
  transitType: TransitType;
  reason?: string;
  context?: Record<string, unknown>;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toText(value: unknown): string {
  return String(value || '').trim();
}

function toIsoText(value: unknown): string {
  const normalized = toText(value);
  if (!normalized) return new Date(0).toISOString();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  return parsed.toISOString();
}

function toTransitType(value: unknown): TransitType {
  const normalized = toText(value).toUpperCase();
  if (normalized === 'OUTBOUND') return 'OUTBOUND';
  if (normalized === 'RETURN') return 'RETURN';
  return 'INBOUND';
}

function toTransitStatus(value: unknown): TransitStatus {
  const normalized = toText(value).toUpperCase();
  if (normalized === 'COMPLETED') return 'COMPLETED';
  if (normalized === 'ABANDONED') return 'ABANDONED';
  return 'ACTIVE';
}

function normalizeTransitContext(value: unknown): TransitContextDto | null {
  const record = toRecord(value);
  if (!record) return null;
  return {
    reason: toText(record.reason) || undefined,
    handoffRefs: toRecord(record.handoffRefs) || undefined,
    memoryRefIds: Array.isArray(record.memoryRefIds) ? record.memoryRefIds.map((item) => toText(item)).filter(Boolean) : undefined,
    stateRecordIds: Array.isArray(record.stateRecordIds) ? record.stateRecordIds.map((item) => toText(item)).filter(Boolean) : undefined,
  };
}

export function normalizeTransitDetail(value: unknown): TransitDetailDto | null {
  const record = toRecord(value);
  if (!record) return null;
  const id = toText(record.id);
  const userId = toText(record.userId);
  const agentId = toText(record.agentId);
  const toWorldId = toText(record.toWorldId);
  if (!id || !userId || !agentId || !toWorldId) return null;
  return {
    id,
    userId,
    agentId,
    fromWorldId: toText(record.fromWorldId) || null,
    toWorldId,
    transitType: toTransitType(record.transitType),
    status: toTransitStatus(record.status),
    departedAt: toIsoText(record.departedAt),
    arrivedAt: toText(record.arrivedAt) || null,
    context: normalizeTransitContext(record.context),
    createdAt: toIsoText(record.createdAt),
  };
}

function normalizeSceneQuota(value: unknown): SceneQuotaDto {
  const record = toRecord(value) || {};
  const used = Number(record.used);
  const quota = Number(record.quota);
  const tierRaw = toText(record.tier).toUpperCase();
  const tier: SceneQuotaTier = tierRaw === 'PRO' || tierRaw === 'MAX' ? tierRaw : 'FREE';
  return {
    used: Number.isFinite(used) && used >= 0 ? Math.floor(used) : 0,
    quota: Number.isFinite(quota) && quota >= 0 ? Math.floor(quota) : 0,
    tier,
  };
}

function normalizeTransitList(value: unknown): TransitDetailDto[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTransitDetail(item))
      .filter((item): item is TransitDetailDto => Boolean(item));
  }
  const record = toRecord(value);
  if (!record) return [];
  const items = Array.isArray(record.items) ? record.items : [];
  return items
    .map((item) => normalizeTransitDetail(item))
    .filter((item): item is TransitDetailDto => Boolean(item));
}

function createFlowError(code: string, message?: string): Error {
  const suffix = toText(message);
  return new Error(suffix ? `${code}: ${suffix}` : code);
}

export function isValidTransitStatusTransition(
  fromStatus: TransitStatus,
  toStatus: TransitStatus,
): boolean {
  if (fromStatus !== 'ACTIVE') return false;
  return toStatus === 'COMPLETED' || toStatus === 'ABANDONED';
}

function assertTerminalTransitionAllowed(
  currentStatus: TransitStatus,
  targetStatus: TransitStatus,
): void {
  if (!isValidTransitStatusTransition(currentStatus, targetStatus)) {
    throw createFlowError(
      'WORLD_TRANSIT_INVALID_STATE_TRANSITION',
      `${currentStatus} -> ${targetStatus}`,
    );
  }
}

function normalizeTransitInput(input: StartWorldTransitInput): StartWorldTransitInput {
  const agentId = toText(input.agentId);
  const toWorldId = toText(input.toWorldId);
  const fromWorldId = toText(input.fromWorldId);
  if (!agentId) throw createFlowError('WORLD_TRANSIT_AGENT_ID_REQUIRED');
  if (!toWorldId) throw createFlowError('WORLD_TRANSIT_WORLD_ID_REQUIRED');
  return {
    agentId,
    toWorldId,
    fromWorldId: fromWorldId || undefined,
    transitType: input.transitType,
    reason: toText(input.reason) || undefined,
    context: toRecord(input.context) || undefined,
  };
}

export async function loadSceneQuota(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SceneQuotaDto> {
  try {
    const payload = await callApi(
      (realm) => fetchSceneQuota(realm),
      '加载场景配额失败',
    );
    return normalizeSceneQuota(payload);
  } catch (error) {
    emitDataSyncError('load-scene-quota', error);
    throw error;
  }
}

async function getTransitById(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  transitId: string,
): Promise<TransitDetailDto> {
  const normalizedTransitId = toText(transitId);
  if (!normalizedTransitId) throw createFlowError('WORLD_TRANSIT_ID_REQUIRED');
  try {
    const payload = await callApi(
      (realm) => fetchTransitById(realm, normalizedTransitId),
      '加载跃迁详情失败',
    );
    const detail = normalizeTransitDetail(payload);
    if (!detail) {
      throw createFlowError('WORLD_TRANSIT_DETAIL_INVALID');
    }
    return detail;
  } catch (error) {
    emitDataSyncError('get-world-transit', error, { transitId: normalizedTransitId });
    throw error;
  }
}

export async function startWorldTransit(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: StartWorldTransitInput,
): Promise<TransitDetailDto> {
  const normalized = normalizeTransitInput(input);
  const sceneQuota = await loadSceneQuota(callApi, emitDataSyncError);
  if (sceneQuota.used >= sceneQuota.quota) {
    throw createFlowError(
      'WORLD_TRANSIT_SCENE_QUOTA_EXCEEDED',
      `${sceneQuota.used}/${sceneQuota.quota}`,
    );
  }

  try {
    const payload = await callApi(
      (realm) => createTransit(realm, {
        agentId: normalized.agentId,
        fromWorldId: normalized.fromWorldId,
        toWorldId: normalized.toWorldId,
        transitType: normalized.transitType,
        reason: normalized.reason,
        context: normalized.context,
      }),
      '创建跃迁会话失败',
    );
    const detail = normalizeTransitDetail(payload);
    if (!detail) {
      throw createFlowError('WORLD_TRANSIT_CREATE_INVALID_PAYLOAD');
    }
    return detail;
  } catch (error) {
    emitDataSyncError('start-world-transit:create', error, {
      worldId: normalized.toWorldId,
      agentId: normalized.agentId,
    });
    throw error;
  }
}

export async function listWorldTransits(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  query?: {
    agentId?: string;
    status?: TransitStatus;
    transitType?: TransitType;
  },
): Promise<TransitDetailDto[]> {
  try {
    const payload = await callApi(
      (realm) => listTransits(realm, {
        agentId: toText(query?.agentId) || undefined,
        status: query?.status,
        transitType: query?.transitType,
      }),
      '加载跃迁列表失败',
    );
    return normalizeTransitList(payload);
  } catch (error) {
    emitDataSyncError('list-world-transits', error, {
      hasAgentId: Boolean(toText(query?.agentId)),
      status: query?.status || null,
      transitType: query?.transitType || null,
    });
    throw error;
  }
}

export async function getActiveWorldTransit(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  agentId: string,
): Promise<TransitDetailDto | null> {
  const normalizedAgentId = toText(agentId);
  if (!normalizedAgentId) throw createFlowError('WORLD_TRANSIT_AGENT_ID_REQUIRED');
  try {
    const payload = await callApi(
      (realm) => fetchActiveTransit(realm, normalizedAgentId),
      '加载活跃跃迁失败',
    );
    return normalizeTransitDetail(payload);
  } catch (error) {
    emitDataSyncError('get-active-world-transit', error, { agentId: normalizedAgentId });
    throw error;
  }
}

export async function completeWorldTransit(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  transitId: string,
): Promise<TransitDetailDto> {
  const current = await getTransitById(callApi, emitDataSyncError, transitId);
  assertTerminalTransitionAllowed(current.status, 'COMPLETED');
  try {
    const payload = await callApi(
      (realm) => completeTransitById(realm, current.id),
      '完成跃迁失败',
    );
    const detail = normalizeTransitDetail(payload);
    if (!detail) throw createFlowError('WORLD_TRANSIT_COMPLETE_INVALID_PAYLOAD');
    if (detail.status !== 'COMPLETED') {
      throw createFlowError('WORLD_TRANSIT_COMPLETE_STATE_INVALID', detail.status);
    }
    return detail;
  } catch (error) {
    emitDataSyncError('complete-world-transit', error, { transitId: current.id });
    throw error;
  }
}

export async function abandonWorldTransit(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  transitId: string,
): Promise<TransitDetailDto> {
  const current = await getTransitById(callApi, emitDataSyncError, transitId);
  assertTerminalTransitionAllowed(current.status, 'ABANDONED');
  try {
    const payload = await callApi(
      (realm) => abandonTransitById(realm, current.id),
      '放弃跃迁失败',
    );
    const detail = normalizeTransitDetail(payload);
    if (!detail) throw createFlowError('WORLD_TRANSIT_ABANDON_INVALID_PAYLOAD');
    if (detail.status !== 'ABANDONED') {
      throw createFlowError('WORLD_TRANSIT_ABANDON_STATE_INVALID', detail.status);
    }
    return detail;
  } catch (error) {
    emitDataSyncError('abandon-world-transit', error, { transitId: current.id });
    throw error;
  }
}
