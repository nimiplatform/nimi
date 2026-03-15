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

type AgentChatRouteResult = {
  channel: 'CLOUD' | 'LOCAL';
  providerSelectable: boolean;
  reason: string;
  sessionClass: 'AGENT_LOCAL' | 'HUMAN_DIRECT';
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

type RealmRequestFn = <T>(spec: RealmRequestSpec) => Promise<T>;

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

function isAgentChatRouteResult(value: unknown): value is AgentChatRouteResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.channel !== 'CLOUD' && record.channel !== 'LOCAL') {
    return false;
  }
  if (typeof record.providerSelectable !== 'boolean') {
    return false;
  }
  if (typeof record.reason !== 'string') {
    return false;
  }
  if (record.sessionClass !== 'AGENT_LOCAL' && record.sessionClass !== 'HUMAN_DIRECT') {
    return false;
  }
  return true;
}

type MemoryIndexEntry = {
  core: AgentMemoryRecord[];
  hasCoreSlice: boolean;
  e2eByEntity: Map<string, AgentMemoryRecord[]>;
  loadedE2EEntities: Set<string>;
  stats: MemoryStatsResponseDto | null;
  hasStats: boolean;
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
    hasCoreSlice: previous?.hasCoreSlice === true,
    e2eByEntity: previous?.e2eByEntity || new Map<string, AgentMemoryRecord[]>(),
    loadedE2EEntities: previous?.loadedE2EEntities || new Set<string>(),
    stats: previous?.stats || null,
    hasStats: previous?.hasStats === true,
    updatedAt: Date.now(),
  };

  if (Array.isArray(input.core)) {
    next.core = dedupeMemory(input.core);
    next.hasCoreSlice = true;
  }

  if (input.entityId && Array.isArray(input.e2e)) {
    next.e2eByEntity.set(input.entityId, dedupeMemory(input.e2e));
    next.loadedE2EEntities.add(input.entityId);
  }

  if (typeof input.stats !== 'undefined') {
    next.stats = input.stats;
    next.hasStats = input.stats !== null;
  }

  memoryLocalIndex.set(input.agentId, next);
  return next;
}

async function resolveCurrentUserIdWith(requestRealmFn: RealmRequestFn): Promise<string | null> {
  const cached = currentUserIdCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  try {
    const payload = await requestRealmFn<unknown>({
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

async function resolveEntityId(
  query: Record<string, unknown>,
  resolveCurrentUserIdFn: () => Promise<string | null>,
): Promise<string | null> {
  const explicit = String(query.entityId || query.userId || query.subjectId || '').trim();
  if (explicit) return explicit;
  return resolveCurrentUserIdFn();
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

async function loadRemoteCoreMemories(
  requestRealmFn: RealmRequestFn,
  agentId: string,
  query?: AgentMemorySliceQuery,
): Promise<AgentMemoryRecord[]> {
  const payload = await requestRealmFn<unknown>({
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
  requestRealm: RealmRequestFn;
  agentId: string;
  entityId: string;
  query?: AgentMemorySliceQuery;
}): Promise<AgentMemoryRecord[]> {
  const payload = await input.requestRealm<unknown>({
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
  requestRealm: RealmRequestFn;
  agentId: string;
  entityId: string;
  query?: AgentMemoryRecallQuery;
}): Promise<{
  items: AgentMemoryRecord[];
  core: AgentMemoryRecord[];
  e2e: AgentMemoryRecord[];
}> {
  const payload = await input.requestRealm<unknown>({
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

async function loadRemoteMemoryStats(
  requestRealmFn: RealmRequestFn,
  agentId: string,
): Promise<MemoryStatsResponseDto> {
  return requestRealmFn<MemoryStatsResponseDto>({
    method: 'GET',
    url: '/api/agent/accounts/{id}/memory/stats',
    path: {
      id: agentId,
    },
  });
}

type AgentCoreDataCapabilityDeps = {
  requestRealm?: RealmRequestFn;
  resolveCurrentUserId?: () => Promise<string | null>;
};

export type AgentCoreDataCapabilityHandlers = {
  agentChatRouteResolve: (query: Record<string, unknown>) => Promise<AgentChatRouteResult>;
  agentMemoryCoreList: (query: Record<string, unknown>) => Promise<{ items: AgentMemoryRecord[]; source: 'local-index-only' | 'remote-only' }>;
  agentMemoryE2EList: (query: Record<string, unknown>) => Promise<{ items: AgentMemoryRecord[]; source: 'local-index-only' | 'remote-only'; entityId: string }>;
  agentMemoryRecallForEntity: (query: Record<string, unknown>) => Promise<{
    items: AgentMemoryRecord[];
    core: AgentMemoryRecord[];
    e2e: AgentMemoryRecord[];
    entityId: string;
    recallSource: 'local-index-only' | 'remote-only' | 'local-index+remote-backfill';
  }>;
  agentMemoryStatsGet: (query: Record<string, unknown>) => Promise<(Record<string, unknown> & { source: 'local-index-only' | 'remote-only' }) | null>;
};

function requireAgentId(query: Record<string, unknown>): string {
  const agentId = String(query.agentId || query.id || '').trim();
  if (!agentId) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  return agentId;
}

async function requireEntityId(
  query: Record<string, unknown>,
  resolveCurrentUserIdFn: () => Promise<string | null>,
): Promise<string> {
  const entityId = await resolveEntityId(query, resolveCurrentUserIdFn);
  if (!entityId) {
    throw new Error('AGENT_MEMORY_ENTITY_ID_REQUIRED');
  }
  return entityId;
}

export function resetAgentCoreDataStateForTesting(): void {
  memoryLocalIndex.clear();
  currentUserIdCache = null;
}

export function seedAgentMemoryIndexForTesting(input: {
  agentId: string;
  core?: AgentMemoryRecord[];
  entityId?: string;
  e2e?: AgentMemoryRecord[];
  stats?: MemoryStatsResponseDto | null;
}): void {
  upsertMemoryIndex(input);
}

export function createAgentCoreDataCapabilityHandlers(
  deps: AgentCoreDataCapabilityDeps = {},
): AgentCoreDataCapabilityHandlers {
  const requestRealmFn = deps.requestRealm ?? requestRealm;
  const resolveCurrentUserIdFn = deps.resolveCurrentUserId ?? (() => resolveCurrentUserIdWith(requestRealmFn));

  return {
    agentChatRouteResolve: async (query) => {
      const agentId = requireAgentId(toRecord(query));
      const payload = await requestRealmFn<unknown>({
        method: 'POST',
        url: '/api/desktop/chat/route',
        body: {
          targetType: 'AGENT',
          agentId,
        },
      });
      if (!isAgentChatRouteResult(payload)) {
        throw new Error('AGENT_CHAT_ROUTE_INVALID');
      }
      return payload;
    },

    agentMemoryCoreList: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const memoryQuery = toMemorySliceQuery(queryRecord);
      const localIndex = getMemoryIndex(agentId);
      if (localIndex?.hasCoreSlice) {
        const limit = memoryQuery?.limit || localIndex.core.length;
        return {
          items: takeTop(localIndex.core, limit),
          source: 'local-index-only' as const,
        };
      }

      const remoteItems = await loadRemoteCoreMemories(requestRealmFn, agentId, memoryQuery);
      upsertMemoryIndex({ agentId, core: remoteItems });
      return {
        items: remoteItems,
        source: 'remote-only' as const,
      };
    },

    agentMemoryE2EList: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const entityId = await requireEntityId(queryRecord, resolveCurrentUserIdFn);
      const memoryQuery = toMemorySliceQuery(queryRecord);
      const localIndex = getMemoryIndex(agentId);
      if (localIndex?.loadedE2EEntities.has(entityId)) {
        const localItems = localIndex.e2eByEntity.get(entityId) || [];
        const limit = memoryQuery?.limit || localItems.length;
        return {
          items: takeTop(localItems, limit),
          source: 'local-index-only' as const,
          entityId,
        };
      }

      const remoteItems = await loadRemoteE2EMemories({
        requestRealm: requestRealmFn,
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
    },

    agentMemoryRecallForEntity: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const entityId = await requireEntityId(queryRecord, resolveCurrentUserIdFn);

      const recallQuery = toMemoryRecallQuery(queryRecord);
      const sliceQuery = toMemorySliceQuery(queryRecord);
      const topK = recallQuery?.topK || 10;
      const localIndex = getMemoryIndex(agentId);
      const localCore = localIndex?.core || [];
      const localE2E = localIndex?.e2eByEntity.get(entityId) || [];
      const localCombined = takeTop(dedupeMemory([...localE2E, ...localCore]), topK);
      if (localCombined.length >= topK) {
        return {
          items: localCombined,
          core: takeTop(localCore, topK),
          e2e: takeTop(localE2E, topK),
          entityId,
          recallSource: 'local-index-only' as const,
        };
      }

      const [remoteRecall, remoteCore, remoteE2E] = await Promise.all([
        loadRemoteRecall({
          requestRealm: requestRealmFn,
          agentId,
          entityId,
          query: recallQuery,
        }),
        loadRemoteCoreMemories(requestRealmFn, agentId, sliceQuery),
        loadRemoteE2EMemories({
          requestRealm: requestRealmFn,
          agentId,
          entityId,
          query: sliceQuery,
        }),
      ]);

      const mergedCore = dedupeMemory([
        ...remoteCore,
        ...remoteRecall.core,
        ...localCore,
      ]);
      const mergedE2E = dedupeMemory([
        ...remoteE2E,
        ...remoteRecall.e2e,
        ...localE2E,
      ]);
      const mergedCombined = dedupeMemory([
        ...remoteRecall.items,
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
      return {
        items: takeTop(mergedCombined, topK),
        core: takeTop(mergedCore, topK),
        e2e: takeTop(mergedE2E, topK),
        entityId,
        recallSource: hasLocal ? 'local-index+remote-backfill' as const : 'remote-only' as const,
      };
    },

    agentMemoryStatsGet: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);

      const localIndex = getMemoryIndex(agentId);
      if (localIndex?.hasStats && localIndex.stats) {
        return {
          ...localIndex.stats,
          source: 'local-index-only' as const,
        };
      }

      const stats = await loadRemoteMemoryStats(requestRealmFn, agentId);
      upsertMemoryIndex({
        agentId,
        stats,
      });
      return {
        ...stats,
        source: 'remote-only' as const,
      };
    },
  };
}

export async function registerCoreDataCapabilities(): Promise<void> {
  const agentHandlers = createAgentCoreDataCapabilityHandlers();

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

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentChatRouteResolve, async (query) => {
    return agentHandlers.agentChatRouteResolve(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryCoreList, async (query) => {
    return agentHandlers.agentMemoryCoreList(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryE2EList, async (query) => {
    return agentHandlers.agentMemoryE2EList(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryRecallForEntity, async (query) => {
    return agentHandlers.agentMemoryRecallForEntity(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryStatsGet, async (query) => {
    return agentHandlers.agentMemoryStatsGet(toRecord(query));
  });
}
