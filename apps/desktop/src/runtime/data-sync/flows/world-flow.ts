import type { Realm } from '@nimiplatform/sdk/realm';
import type { WorldDetailDto } from '@nimiplatform/sdk/realm';
import type { WorldLevelAuditEventDto } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type WorldSemanticBundle = {
  world: WorldDetailDto | null;
  worldview: Record<string, unknown> | null;
  worldviewEvents: Array<Record<string, unknown>>;
  worldviewSnapshots: Array<Record<string, unknown>>;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>);
  }
  const payload = toRecord(value);
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload.items)) {
    return toRecordArray(payload.items);
  }
  if (Array.isArray(payload.data)) {
    return toRecordArray(payload.data);
  }
  return [];
}

export async function loadWorldList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
): Promise<WorldDetailDto[]> {
  try {
    const worlds = await callApi(
      (realm) => realm.services.WorldsService.worldControllerListWorlds(status),
      '加载世界列表失败',
    );
    return Array.isArray(worlds) ? worlds : [];
  } catch (error) {
    emitDataSyncError('load-world-list', error);
    throw error;
  }
}

export async function loadMainWorld(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<WorldDetailDto> {
  try {
    return await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetMainWorld(),
      '加载主世界失败',
    );
  } catch (error) {
    emitDataSyncError('load-main-world', error);
    throw error;
  }
}

export async function loadWorldLevelAudits(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
  limit = 20,
): Promise<WorldLevelAuditEventDto[]> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  const normalizedLimit = Number.isFinite(limit) && limit > 0
    ? Math.min(Math.floor(limit), 100)
    : 20;
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldLevelAudits(normalizedWorldId, normalizedLimit),
      '加载世界等级审计失败',
    );
    if (!Array.isArray(payload)) return [];
    return payload
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as WorldLevelAuditEventDto);
  } catch (error) {
    emitDataSyncError('load-world-level-audits', error, {
      worldId: normalizedWorldId,
      limit: normalizedLimit,
    });
    throw error;
  }
}

export async function loadWorldDetailById(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldDetailDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorld(normalizedWorldId),
      '加载世界详情失败',
    );
    const record = toRecord(payload);
    return record ? (record as unknown as WorldDetailDto) : null;
  } catch (error) {
    emitDataSyncError('load-world-detail', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldEvents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<Array<Record<string, unknown>>> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldControlService.worldControlControllerListWorldEvents(normalizedWorldId),
      '加载世界事件列表失败',
    );
    const record = toRecord(payload);
    if (record && Array.isArray(record.items)) {
      return toRecordArray(record.items);
    }
    return toRecordArray(payload);
  } catch (error) {
    emitDataSyncError('load-world-events', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldAgents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<Array<Record<string, unknown>>> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldAgents(normalizedWorldId),
      '加载世界Agent列表失败',
    );
    return toRecordArray(payload);
  } catch (error) {
    emitDataSyncError('load-world-agents', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldDetailWithAgents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<Record<string, unknown> | null> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(normalizedWorldId),
      '加载世界详情(含Agent)失败',
    );
    return toRecord(payload);
  } catch (error) {
    emitDataSyncError('load-world-detail-with-agents', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldSemanticBundle(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldSemanticBundle> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }

  try {
    const world = await loadWorldDetailById(callApi, emitDataSyncError, normalizedWorldId);
    const [worldview, worldviewEvents, worldviewSnapshots] = await Promise.all([
      (async () => {
        try {
          const payload = await callApi(
            (realm) => realm.services.WorldsService.worldControllerGetWorldview(normalizedWorldId),
            '加载世界观失败',
          );
          return toRecord(payload);
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const payload = await callApi(
            (realm) => realm.services.WorldsService.worldControllerGetWorldviewEvents(normalizedWorldId, 0, 50),
            '加载世界观事件失败',
          );
          return toRecordArray(payload);
        } catch {
          return [];
        }
      })(),
      (async () => {
        try {
          const payload = await callApi(
            (realm) => realm.services.WorldsService.worldControllerGetWorldviewSnapshots(normalizedWorldId),
            '加载世界观快照失败',
          );
          return toRecordArray(payload);
        } catch {
          return [];
        }
      })(),
    ]);

    return {
      world,
      worldview,
      worldviewEvents,
      worldviewSnapshots,
    };
  } catch (error) {
    emitDataSyncError('load-world-semantic-bundle', error, { worldId: normalizedWorldId });
    throw error;
  }
}
