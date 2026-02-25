import {
  abandonTransitById,
  appendTransitCheckpoint as appendTransitCheckpointFromClient,
  completeTransitById,
  createTransit,
  fetchActiveTransit,
  fetchSceneQuota,
  fetchTransitById,
  listTransits,
  startTransitSessionById,
} from '../clients/transit-client';
import { requestWorldTransitGate } from '../clients/world-client';

type DataSyncApiCaller = <T>(task: () => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type TransitType = 'INBOUND' | 'OUTBOUND' | 'RETURN';
export type TransitStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
export type TransitCheckpointStatus = 'PASSED' | 'FAILED' | 'SKIPPED';
export type SceneQuotaTier = 'FREE' | 'PRO' | 'MAX';

export type TransitCheckpointDto = {
  name: string;
  timestamp: string;
  status: TransitCheckpointStatus;
  data?: Record<string, unknown>;
};

export type TransitSessionDataDto = {
  startedAt: string;
  endedAt?: string;
  reason?: string;
  carriedState?: Record<string, unknown>;
  checkpoints?: TransitCheckpointDto[];
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
  sessionData: TransitSessionDataDto | null;
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
  carriedState?: Record<string, unknown>;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>);
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

function toCheckpointStatus(value: unknown): TransitCheckpointStatus {
  const normalized = toText(value).toUpperCase();
  if (normalized === 'FAILED') return 'FAILED';
  if (normalized === 'SKIPPED') return 'SKIPPED';
  return 'PASSED';
}

function normalizeCheckpoint(value: unknown): TransitCheckpointDto | null {
  const record = toRecord(value);
  if (!record) return null;
  const name = toText(record.name);
  if (!name) return null;
  return {
    name,
    timestamp: toIsoText(record.timestamp),
    status: toCheckpointStatus(record.status),
    data: toRecord(record.data) || undefined,
  };
}

function normalizeTransitSessionData(value: unknown): TransitSessionDataDto | null {
  const record = toRecord(value);
  if (!record) return null;
  const startedAt = toIsoText(record.startedAt);
  const checkpoints = toRecordArray(record.checkpoints)
    .map((item) => normalizeCheckpoint(item))
    .filter((item): item is TransitCheckpointDto => Boolean(item));
  return {
    startedAt,
    endedAt: toText(record.endedAt) || undefined,
    reason: toText(record.reason) || undefined,
    carriedState: toRecord(record.carriedState) || undefined,
    checkpoints: checkpoints.length > 0 ? checkpoints : undefined,
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
    sessionData: normalizeTransitSessionData(record.sessionData),
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

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
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
    carriedState: toRecord(input.carriedState) || undefined,
  };
}

export async function loadSceneQuota(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SceneQuotaDto> {
  try {
    const payload = await callApi(
      () => fetchSceneQuota(),
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
      () => fetchTransitById(normalizedTransitId),
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
    await callApi(
      () => requestWorldTransitGate(normalized.toWorldId),
      '世界配额闸校验失败',
    );
  } catch (error) {
    const flowError = createFlowError('WORLD_TRANSIT_WORLD_GATE_REJECTED', toErrorText(error));
    emitDataSyncError('start-world-transit:world-gate', flowError, {
      worldId: normalized.toWorldId,
      agentId: normalized.agentId,
    });
    throw flowError;
  }

  try {
    const payload = await callApi(
      () => createTransit({
        agentId: normalized.agentId,
        fromWorldId: normalized.fromWorldId,
        toWorldId: normalized.toWorldId,
        transitType: normalized.transitType,
        reason: normalized.reason,
        carriedState: normalized.carriedState,
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
      () => listTransits({
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
      () => fetchActiveTransit(normalizedAgentId),
      '加载活跃跃迁失败',
    );
    return normalizeTransitDetail(payload);
  } catch (error) {
    emitDataSyncError('get-active-world-transit', error, { agentId: normalizedAgentId });
    throw error;
  }
}

export async function startTransitSession(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  transitId: string,
): Promise<TransitSessionDataDto> {
  const normalizedTransitId = toText(transitId);
  if (!normalizedTransitId) throw createFlowError('WORLD_TRANSIT_ID_REQUIRED');
  try {
    const payload = await callApi(
      () => startTransitSessionById(normalizedTransitId),
      '启动跃迁会话失败',
    );
    const sessionData = normalizeTransitSessionData(payload);
    if (!sessionData) {
      throw createFlowError('WORLD_TRANSIT_SESSION_INVALID');
    }
    return sessionData;
  } catch (error) {
    emitDataSyncError('start-transit-session', error, { transitId: normalizedTransitId });
    throw error;
  }
}

export async function addTransitCheckpoint(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  transitId: string,
  input: {
    name: string;
    status: TransitCheckpointStatus;
    data?: Record<string, unknown>;
  },
): Promise<TransitDetailDto> {
  const normalizedTransitId = toText(transitId);
  const checkpointName = toText(input.name);
  if (!normalizedTransitId) throw createFlowError('WORLD_TRANSIT_ID_REQUIRED');
  if (!checkpointName) throw createFlowError('WORLD_TRANSIT_CHECKPOINT_NAME_REQUIRED');

  try {
    const payload = await callApi(
      () => appendTransitCheckpointFromClient({
        transitId: normalizedTransitId,
        name: checkpointName,
        status: input.status,
        data: toRecord(input.data) || undefined,
      }),
      '添加跃迁检查点失败',
    );
    const detail = normalizeTransitDetail(payload);
    if (!detail) throw createFlowError('WORLD_TRANSIT_CHECKPOINT_INVALID_PAYLOAD');
    return detail;
  } catch (error) {
    emitDataSyncError('add-transit-checkpoint', error, {
      transitId: normalizedTransitId,
      status: input.status,
    });
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
      () => completeTransitById(current.id),
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
      () => abandonTransitById(current.id),
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
