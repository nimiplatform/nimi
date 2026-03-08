import type { MemoryStatsResponseDto } from '@nimiplatform/sdk/realm';
import { CORE_DATA_API_CAPABILITIES, toRecord } from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

function toObjectOr<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? (value as T) : fallback;
}

function toNullableObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

type AgentMemoryRecord = Record<string, unknown>;

type AgentMemorySliceQuery = {
  limit?: number;
  offset?: number;
};

type AgentMemoryRecallQuery = {
  queryText?: string;
  topK?: number;
};

type RealmRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

type RealmRequestSpec = {
  method: RealmRequestMethod;
  url: string;
  path?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

function resolveRequestPath(
  url: string,
  pathParams?: Record<string, string | number | boolean>,
): string {
  let resolved = String(url || '').trim();
  for (const [key, value] of Object.entries(pathParams || {})) {
    resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

async function requestRealm<T>(spec: RealmRequestSpec): Promise<T> {
  return withRuntimeOpenApiContext((realm) => realm.raw.request<T>({
    method: spec.method,
    path: resolveRequestPath(spec.url, spec.path),
    query: spec.query,
    body: spec.body,
    headers: spec.headers,
    timeoutMs: spec.timeoutMs,
  }));
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : undefined;
}

function toNonNegativeInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  return rounded >= 0 ? rounded : undefined;
}

function takeTop<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

function memoryIdentity(item: AgentMemoryRecord): string {
  const id = String(item.id || '').trim();
  if (id) return `id:${id}`;
  const content = String(item.content || item.text || item.summary || '').trim();
  return content ? `content:${content}` : `raw:${JSON.stringify(item)}`;
}

function dedupeMemory(items: AgentMemoryRecord[]): AgentMemoryRecord[] {
  const seen = new Set<string>();
  const deduped: AgentMemoryRecord[] = [];
  for (const item of items) {
    const key = memoryIdentity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function toMemoryRecordArray(value: unknown): AgentMemoryRecord[] {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as AgentMemoryRecord);
  }
  const record = toRecord(value);
  if (Array.isArray(record.items)) {
    return toMemoryRecordArray(record.items);
  }
  if (Array.isArray(record.data)) {
    return toMemoryRecordArray(record.data);
  }
  return [];
}

function inferRecallKind(item: AgentMemoryRecord): 'core' | 'e2e' {
  const typeField = String(item.type || item.memoryType || '').trim().toUpperCase();
  if (typeField === 'E2E' || typeField === 'EPISODIC') {
    return 'e2e';
  }
  const subject = String(item.subjectId || item.entityId || '').trim();
  if (subject) {
    return 'e2e';
  }
  return 'core';
}

function toSliceQueryPayload(query: AgentMemorySliceQuery | undefined): Record<string, number> | undefined {
  const next: Record<string, number> = {};
  if (typeof query?.limit === 'number') {
    next.limit = query.limit;
  }
  if (typeof query?.offset === 'number') {
    next.offset = query.offset;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function toRecallQueryPayload(query: AgentMemoryRecallQuery | undefined): Record<string, string | number> | undefined {
  const next: Record<string, string | number> = {};
  if (typeof query?.topK === 'number') {
    next.topK = query.topK;
    next.limit = query.topK;
  }
  if (query?.queryText) {
    next.queryText = query.queryText;
    next.query = query.queryText;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

type MemoryIndexEntry = {
  core: AgentMemoryRecord[];
  e2eByEntity: Map<string, AgentMemoryRecord[]>;
  stats: MemoryStatsResponseDto | null;
  updatedAt: number;
};

const MEMORY_LOCAL_INDEX_TTL_MS = 5 * 60 * 1000;
const memoryLocalIndex = new Map<string, MemoryIndexEntry>();
let currentUserIdCache: { userId: string; expiresAt: number } | null = null;

function getMemoryIndex(agentId: string): MemoryIndexEntry | null {
  const current = memoryLocalIndex.get(agentId);
  if (!current) return null;
  if (Date.now() - current.updatedAt > MEMORY_LOCAL_INDEX_TTL_MS) {
    return null;
  }
  return current;
}

function upsertMemoryIndex(input: {
  agentId: string;
  core?: AgentMemoryRecord[];
  entityId?: string;
  e2e?: AgentMemoryRecord[];
  stats?: MemoryStatsResponseDto | null;
}): MemoryIndexEntry {
  const previous = memoryLocalIndex.get(input.agentId);
  const next: MemoryIndexEntry = {
    core: previous?.core || [],
    e2eByEntity: previous?.e2eByEntity || new Map<string, AgentMemoryRecord[]>(),
    stats: previous?.stats || null,
    updatedAt: Date.now(),
  };

  if (Array.isArray(input.core)) {
    next.core = dedupeMemory(input.core);
  }

  if (input.entityId && Array.isArray(input.e2e)) {
    next.e2eByEntity.set(input.entityId, dedupeMemory(input.e2e));
  }

  if (typeof input.stats !== 'undefined') {
    next.stats = input.stats;
  }

  memoryLocalIndex.set(input.agentId, next);
  return next;
}

async function resolveCurrentUserId(): Promise<string | null> {
  const cached = currentUserIdCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  try {
    const payload = await requestRealm<unknown>({
      method: 'GET',
      url: '/api/human/me',
    });
    const userId = String(toRecord(payload).id || '').trim();
    if (!userId) return null;
    currentUserIdCache = {
      userId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    return userId;
  } catch {
    return null;
  }
}

async function resolveEntityId(query: Record<string, unknown>): Promise<string | null> {
  const explicit = String(query.entityId || query.userId || query.subjectId || '').trim();
  if (explicit) return explicit;
  return resolveCurrentUserId();
}

function toMemorySliceQuery(query: Record<string, unknown>): AgentMemorySliceQuery | undefined {
  const limit = toPositiveInt(query.limit);
  const offset = toNonNegativeInt(query.offset);
  if (typeof limit !== 'number' && typeof offset !== 'number') {
    return undefined;
  }
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof offset === 'number' ? { offset } : {}),
  };
}

function toMemoryRecallQuery(query: Record<string, unknown>): AgentMemoryRecallQuery | undefined {
  const topK = toPositiveInt(query.topK ?? query.limit);
  const queryText = String(query.queryText || query.query || '').trim();
  if (typeof topK !== 'number' && !queryText) {
    return undefined;
  }
  return {
    ...(queryText ? { queryText } : {}),
    ...(typeof topK === 'number' ? { topK } : {}),
  };
}

async function loadRemoteCoreMemories(agentId: string, query?: AgentMemorySliceQuery): Promise<AgentMemoryRecord[]> {
  const payload = await requestRealm<unknown>({
    method: 'GET',
    url: '/api/agent/accounts/{id}/memory/core',
    path: {
      id: agentId,
    },
    query: toSliceQueryPayload(query),
  });
  return toMemoryRecordArray(payload);
}

async function loadRemoteE2EMemories(input: {
  agentId: string;
  entityId: string;
  query?: AgentMemorySliceQuery;
}): Promise<AgentMemoryRecord[]> {
  const payload = await requestRealm<unknown>({
    method: 'GET',
    url: '/api/agent/accounts/{id}/memory/e2e/{entityId}',
    path: {
      id: input.agentId,
      entityId: input.entityId,
    },
    query: toSliceQueryPayload(input.query),
  });
  return toMemoryRecordArray(payload);
}

async function loadRemoteRecall(input: {
  agentId: string;
  entityId: string;
  query?: AgentMemoryRecallQuery;
}): Promise<{
  items: AgentMemoryRecord[];
  core: AgentMemoryRecord[];
  e2e: AgentMemoryRecord[];
}> {
  const payload = await requestRealm<unknown>({
    method: 'GET',
    url: '/api/agent/accounts/{id}/memory/recall/{entityId}',
    path: {
      id: input.agentId,
      entityId: input.entityId,
    },
    query: toRecallQueryPayload(input.query),
  });
  const root = toRecord(payload);
  const explicitCore = toMemoryRecordArray(root.core || root.coreMemory || root.coreMemories);
  const explicitE2E = toMemoryRecordArray(root.e2e || root.e2eMemory || root.e2eMemories);
  if (explicitCore.length > 0 || explicitE2E.length > 0) {
    return {
      items: [...explicitCore, ...explicitE2E],
      core: explicitCore,
      e2e: explicitE2E,
    };
  }

  const inferredItems = toMemoryRecordArray(payload);
  const core: AgentMemoryRecord[] = [];
  const e2e: AgentMemoryRecord[] = [];
  inferredItems.forEach((item) => {
    if (inferRecallKind(item) === 'e2e') {
      e2e.push(item);
      return;
    }
    core.push(item);
  });

  return {
    items: inferredItems,
    core,
    e2e,
  };
}

async function loadRemoteMemoryStats(agentId: string): Promise<MemoryStatsResponseDto> {
  return requestRealm<MemoryStatsResponseDto>({
    method: 'GET',
    url: '/api/agent/accounts/{id}/memory/stats',
    path: {
      id: agentId,
    },
  });
}

export async function registerCoreDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.friendsWithDetailsList, async () => {
    const payload = await requestRealm<unknown>({
      method: 'GET',
      url: '/api/human/me/friends/list',
      query: { limit: 100 },
    });
    return toObjectOr(payload, { items: [] });
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.userByIdGet, async (query) => {
    const userId = String(toRecord(query).userId || '').trim();
    if (!userId) return null;
    try {
      const payload = await requestRealm<unknown>({
        method: 'GET',
        url: '/api/human/accounts/{id}',
        path: { id: userId },
      });
      return toNullableObject(payload);
    } catch {
      return null;
    }
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.userByHandleGet, async (query) => {
    const handle = String(toRecord(query).handle || '').trim();
    if (!handle) return null;
    try {
      const payload = await requestRealm<unknown>({
        method: 'GET',
        url: '/api/human/handle/{handle}',
        path: { handle },
      });
      return toNullableObject(payload);
    } catch {
      return null;
    }
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.worldByIdGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return null;
    try {
      const payload = await requestRealm<unknown>({
        method: 'GET',
        url: '/api/world/by-id/{id}',
        path: { id: worldId },
      });
      return toNullableObject(payload);
    } catch {
      return null;
    }
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.worldviewByIdGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return null;
    try {
      const payload = await requestRealm<unknown>({
        method: 'GET',
        url: '/api/world/by-id/{id}/worldview',
        path: { id: worldId },
      });
      return toNullableObject(payload);
    } catch {
      return null;
    }
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryCoreList, async (query) => {
    const queryRecord = toRecord(query);
    const agentId = String(queryRecord.agentId || '').trim();
    if (!agentId) {
      return { items: [], source: 'remote-only' as const };
    }

    const memoryQuery = toMemorySliceQuery(queryRecord);
    const localIndex = getMemoryIndex(agentId);
    if (localIndex) {
      const limit = memoryQuery?.limit || localIndex.core.length;
      return {
        items: takeTop(localIndex.core, limit),
        source: 'local-index-only' as const,
      };
    }

    try {
      const remoteItems = await loadRemoteCoreMemories(agentId, memoryQuery);
      upsertMemoryIndex({ agentId, core: remoteItems });
      return {
        items: remoteItems,
        source: 'remote-only' as const,
      };
    } catch {
      return { items: [], source: 'remote-only' as const };
    }
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryE2EList, async (query) => {
    const queryRecord = toRecord(query);
    const agentId = String(queryRecord.agentId || '').trim();
    if (!agentId) {
      return { items: [], source: 'remote-only' as const };
    }
    const entityId = await resolveEntityId(queryRecord);
    if (!entityId) {
      return { items: [], source: 'remote-only' as const };
    }
    const memoryQuery = toMemorySliceQuery(queryRecord);
    const localIndex = getMemoryIndex(agentId);
    if (localIndex?.e2eByEntity.has(entityId)) {
      const localItems = localIndex.e2eByEntity.get(entityId) || [];
      const limit = memoryQuery?.limit || localItems.length;
      return {
        items: takeTop(localItems, limit),
        source: 'local-index-only' as const,
        entityId,
      };
    }

    try {
      const remoteItems = await loadRemoteE2EMemories({
        agentId,
        entityId,
        query: memoryQuery,
      });
      upsertMemoryIndex({
        agentId,
        entityId,
        e2e: remoteItems,
      });
      return {
        items: remoteItems,
        source: 'remote-only' as const,
        entityId,
      };
    } catch {
      return { items: [], source: 'remote-only' as const, entityId };
    }
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryRecallForEntity, async (query) => {
    const queryRecord = toRecord(query);
    const agentId = String(queryRecord.agentId || '').trim();
    if (!agentId) {
      return {
        items: [],
        core: [],
        e2e: [],
        recallSource: 'remote-only' as const,
      };
    }
    const entityId = await resolveEntityId(queryRecord);
    if (!entityId) {
      return {
        items: [],
        core: [],
        e2e: [],
        recallSource: 'remote-only' as const,
      };
    }

    const recallQuery = toMemoryRecallQuery(queryRecord);
    const sliceQuery = toMemorySliceQuery(queryRecord);
    const topK = recallQuery?.topK || 10;
    const localIndex = getMemoryIndex(agentId);
    const localCore = localIndex?.core || [];
    const localE2E = localIndex?.e2eByEntity.get(entityId) || [];
    const localCombined = takeTop(dedupeMemory([...localE2E, ...localCore]), topK);
    const localEnough = localCombined.length >= topK;

    if (localEnough) {
      return {
        items: localCombined,
        core: takeTop(localCore, topK),
        e2e: takeTop(localE2E, topK),
        entityId,
        recallSource: 'local-index-only' as const,
      };
    }

    let remoteRecall: Awaited<ReturnType<typeof loadRemoteRecall>> | null = null;
    let remoteCore: AgentMemoryRecord[] | null = null;
    let remoteE2E: AgentMemoryRecord[] | null = null;

    try {
      remoteRecall = await loadRemoteRecall({
        agentId,
        entityId,
        query: recallQuery,
      });
    } catch {
      remoteRecall = null;
    }

    try {
      remoteCore = await loadRemoteCoreMemories(agentId, sliceQuery);
    } catch {
      remoteCore = null;
    }

    try {
      remoteE2E = await loadRemoteE2EMemories({
        agentId,
        entityId,
        query: sliceQuery,
      });
    } catch {
      remoteE2E = null;
    }

    const mergedCore = dedupeMemory([
      ...(Array.isArray(remoteCore) ? remoteCore : []),
      ...(remoteRecall?.core || []),
      ...localCore,
    ]);
    const mergedE2E = dedupeMemory([
      ...(Array.isArray(remoteE2E) ? remoteE2E : []),
      ...(remoteRecall?.e2e || []),
      ...localE2E,
    ]);
    const mergedCombined = dedupeMemory([
      ...(remoteRecall?.items || []),
      ...mergedE2E,
      ...mergedCore,
    ]);

    upsertMemoryIndex({
      agentId,
      core: mergedCore,
      entityId,
      e2e: mergedE2E,
    });

    const hasLocal = localCore.length > 0 || localE2E.length > 0;
    const hasRemote = Boolean(
      (remoteRecall && (remoteRecall.items.length > 0 || remoteRecall.core.length > 0 || remoteRecall.e2e.length > 0))
      || (remoteCore && remoteCore.length > 0)
      || (remoteE2E && remoteE2E.length > 0),
    );
    const recallSource = hasRemote
      ? (hasLocal ? 'local-index+remote-backfill' : 'remote-only')
      : (hasLocal ? 'local-index-only' : 'remote-only');

    return {
      items: takeTop(mergedCombined, topK),
      core: takeTop(mergedCore, topK),
      e2e: takeTop(mergedE2E, topK),
      entityId,
      recallSource,
    };
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryStatsGet, async (query) => {
    const queryRecord = toRecord(query);
    const agentId = String(queryRecord.agentId || '').trim();
    if (!agentId) return null;

    const localIndex = getMemoryIndex(agentId);
    if (localIndex?.stats) {
      return {
        ...localIndex.stats,
        source: 'local-index-only' as const,
      };
    }

    try {
      const stats = await loadRemoteMemoryStats(agentId);
      upsertMemoryIndex({
        agentId,
        stats,
      });
      return {
        ...stats,
        source: 'remote-only' as const,
      };
    } catch {
      if (localIndex) {
        return {
          coreCount: localIndex.core.length,
          e2eCount: Array.from(localIndex.e2eByEntity.values()).reduce((sum, items) => sum + items.length, 0),
          profileCount: 0,
          source: 'local-index-only' as const,
        };
      }
      return null;
    }
  });
}
