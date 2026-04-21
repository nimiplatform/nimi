import { MemoryCanonicalClass } from '@nimiplatform/sdk/runtime';
import type { DesktopAgentMemoryRecord } from '@renderer/infra/runtime-agent-memory';
import { createRuntimeAgentMemoryAdapter } from '@renderer/infra/runtime-agent-memory';
import {
  CORE_DATA_API_CAPABILITIES,
  requireItemsPayload,
  requireObjectPayload,
  toRecord,
} from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

type AgentMemorySliceQuery = {
  limit?: number;
  offset?: number;
  query?: string;
};

type RuntimeAgentDataClient = {
  getCurrentUser: () => Promise<unknown>;
  listMyFriendsWithDetails: (limit?: number) => Promise<unknown>;
  getUser: (userId: string) => Promise<unknown>;
  getUserByHandle: (handle: string) => Promise<unknown>;
  getWorld: (worldId: string) => Promise<unknown>;
  getWorldview: (worldId: string) => Promise<unknown>;
};

type RuntimeAgentMemoryPort = Pick<
  ReturnType<typeof createRuntimeAgentMemoryAdapter>,
  'queryCompatibilityRecords'
>;

type RuntimeMemoryResult = {
  items: DesktopAgentMemoryRecord[];
  source: 'runtime-only';
};

function createRuntimeAgentDataClient(): RuntimeAgentDataClient {
  return {
    getCurrentUser: () => withRuntimeOpenApiContext((realm) => realm.services.MeService.getMe()),
    listMyFriendsWithDetails: (limit) => withRuntimeOpenApiContext((realm) => (
      realm.services.MeService.listMyFriendsWithDetails(undefined, limit)
    )),
    getUser: (userId) => withRuntimeOpenApiContext((realm) => (
      realm.services.UserService.getUser(userId)
    )),
    getUserByHandle: (handle) => withRuntimeOpenApiContext((realm) => (
      realm.services.UserService.getUserByHandle(handle)
    )),
    getWorld: (worldId) => withRuntimeOpenApiContext((realm) => (
      realm.services.WorldsService.worldControllerGetWorld(worldId)
    )),
    getWorldview: (worldId) => withRuntimeOpenApiContext((realm) => (
      realm.services.WorldsService.worldControllerGetWorldview(worldId)
    )),
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

async function resolveCurrentUserIdWith(client: RuntimeAgentDataClient): Promise<string> {
  const payload = await client.getCurrentUser();
  const userId = normalizeText(toRecord(payload).id);
  if (!userId) {
    throw new Error('CURRENT_USER_ID_CONTRACT_INVALID');
  }
  return userId;
}

async function resolveUserId(
  query: Record<string, unknown>,
  resolveCurrentUserIdFn: () => Promise<string | undefined>,
): Promise<string | undefined> {
  const explicit = normalizeText(query.userId || query.entityId || query.subjectId);
  if (explicit) return explicit;
  return resolveCurrentUserIdFn();
}

function toMemorySliceQuery(query: Record<string, unknown>): AgentMemorySliceQuery | undefined {
  const limit = toPositiveInt(query.limit);
  const offset = toNonNegativeInt(query.offset);
  const textQuery = normalizeText(query.query || query.searchText || query.text);
  if (typeof limit !== 'number' && typeof offset !== 'number' && !textQuery) {
    return undefined;
  }
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof offset === 'number' ? { offset } : {}),
    ...(textQuery ? { query: textQuery } : {}),
  };
}

function requireOffsetSupported(query?: AgentMemorySliceQuery): void {
  if ((query?.offset || 0) > 0) {
    throw new Error('RUNTIME_AGENT_MEMORY_OFFSET_UNSUPPORTED');
  }
}

function requireAgentId(query: Record<string, unknown>): string {
  const agentId = normalizeText(query.agentId || query.id);
  if (!agentId) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  return agentId;
}

async function requireUserId(
  query: Record<string, unknown>,
  resolveCurrentUserIdFn: () => Promise<string | undefined>,
): Promise<string> {
  const userId = await resolveUserId(query, resolveCurrentUserIdFn);
  if (!userId) {
    throw new Error('AGENT_MEMORY_USER_ID_REQUIRED');
  }
  return userId;
}

function unsupportedProfiles(): never {
  throw new Error('AGENT_MEMORY_PROFILES_UNSUPPORTED_BY_RUNTIME_AUTHORITY');
}

type RuntimeAgentDataCapabilityDeps = {
  client?: Partial<RuntimeAgentDataClient>;
  runtimeMemory?: RuntimeAgentMemoryPort;
  resolveCurrentUserId?: () => Promise<string | undefined>;
};

export type RuntimeAgentDataCapabilityHandlers = {
  agentMemoryCoreList: (query: Record<string, unknown>) => Promise<RuntimeMemoryResult>;
  agentMemoryDyadicList: (query: Record<string, unknown>) => Promise<RuntimeMemoryResult & { userId: string }>;
  agentMemoryProfilesList: (_query: Record<string, unknown>) => Promise<{ items: Record<string, unknown>[] } & Record<string, unknown>>;
  agentMemoryRecallForEntity: (query: Record<string, unknown>) => Promise<{ core: DesktopAgentMemoryRecord[]; e2e: DesktopAgentMemoryRecord[]; entityId: string; recallSource: 'runtime-only' }>;
  agentMemoryE2EList: (query: Record<string, unknown>) => Promise<RuntimeMemoryResult & { userId: string }>;
  agentMemoryStatsGet: (query: Record<string, unknown>) => Promise<{ coreCount: number; dyadicCount: number }>;
};

export function resetRuntimeAgentDataStateForTesting(): void {
  // runtime-backed hard-cut intentionally keeps no local memory cache
}

export function createRuntimeAgentDataCapabilityHandlers(
  deps: RuntimeAgentDataCapabilityDeps = {},
): RuntimeAgentDataCapabilityHandlers {
  const client: RuntimeAgentDataClient = {
    ...createRuntimeAgentDataClient(),
    ...(deps.client || {}),
  };
  const resolveCurrentUserIdFn = deps.resolveCurrentUserId ?? (() => resolveCurrentUserIdWith(client));
  let runtimeMemory = deps.runtimeMemory;
  const resolveRuntimeMemory = (): RuntimeAgentMemoryPort => {
    if (!runtimeMemory) {
      runtimeMemory = createRuntimeAgentMemoryAdapter({
        getSubjectUserId: resolveCurrentUserIdFn,
      });
    }
    return runtimeMemory;
  };

  return {
    agentMemoryCoreList: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const memoryQuery = toMemorySliceQuery(queryRecord);
      requireOffsetSupported(memoryQuery);
      const items = await resolveRuntimeMemory().queryCompatibilityRecords({
        agentId,
        displayName: agentId,
        createIfMissing: false,
        syncDyadicContext: false,
        syncWorldContext: false,
        query: memoryQuery?.query,
        limit: memoryQuery?.limit,
        canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
        includeInvalidated: false,
      });
      return {
        items,
        source: 'runtime-only',
      };
    },

    agentMemoryDyadicList: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const userId = await requireUserId(queryRecord, resolveCurrentUserIdFn);
      const memoryQuery = toMemorySliceQuery(queryRecord);
      requireOffsetSupported(memoryQuery);
      const items = await resolveRuntimeMemory().queryCompatibilityRecords({
        agentId,
        displayName: agentId,
        dyadicUserId: userId,
        createIfMissing: false,
        syncDyadicContext: true,
        syncWorldContext: false,
        query: memoryQuery?.query,
        limit: memoryQuery?.limit,
        canonicalClasses: [MemoryCanonicalClass.DYADIC],
        includeInvalidated: false,
      });
      return {
        items,
        source: 'runtime-only',
        userId,
      };
    },

    agentMemoryProfilesList: async (_query) => {
      unsupportedProfiles();
    },

    agentMemoryRecallForEntity: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const userId = await requireUserId(queryRecord, resolveCurrentUserIdFn);
      const memoryQuery = toMemorySliceQuery(queryRecord);
      requireOffsetSupported(memoryQuery);
      const [core, e2e] = await Promise.all([
        resolveRuntimeMemory().queryCompatibilityRecords({
          agentId,
          displayName: agentId,
          dyadicUserId: userId,
          createIfMissing: false,
          syncDyadicContext: true,
          syncWorldContext: false,
          query: memoryQuery?.query,
          limit: memoryQuery?.limit,
          canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
          includeInvalidated: false,
        }),
        resolveRuntimeMemory().queryCompatibilityRecords({
          agentId,
          displayName: agentId,
          dyadicUserId: userId,
          createIfMissing: false,
          syncDyadicContext: true,
          syncWorldContext: false,
          query: memoryQuery?.query,
          limit: memoryQuery?.limit,
          canonicalClasses: [MemoryCanonicalClass.DYADIC],
          includeInvalidated: false,
        }),
      ]);
      return {
        core,
        e2e,
        entityId: userId,
        recallSource: 'runtime-only',
      };
    },

    agentMemoryE2EList: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const userId = await requireUserId(queryRecord, resolveCurrentUserIdFn);
      const memoryQuery = toMemorySliceQuery(queryRecord);
      requireOffsetSupported(memoryQuery);
      const items = await resolveRuntimeMemory().queryCompatibilityRecords({
        agentId,
        displayName: agentId,
        dyadicUserId: userId,
        createIfMissing: false,
        syncDyadicContext: true,
        syncWorldContext: false,
        query: memoryQuery?.query,
        limit: memoryQuery?.limit,
        canonicalClasses: [MemoryCanonicalClass.DYADIC],
        includeInvalidated: false,
      });
      return {
        items,
        source: 'runtime-only',
        userId,
      };
    },

    agentMemoryStatsGet: async (_query) => {
      return {
        coreCount: 0,
        dyadicCount: 0,
      };
    },
  };
}

export async function registerCoreDataCapabilities(): Promise<void> {
  const client = createRuntimeAgentDataClient();
  const agentHandlers = createRuntimeAgentDataCapabilityHandlers({ client });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.friendsWithDetailsList, async () => {
    const payload = await client.listMyFriendsWithDetails(100);
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'CORE_FRIENDS_WITH_DETAILS_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.userByIdGet, async (query) => {
    const userId = normalizeText(toRecord(query).userId);
    if (!userId) throw new Error('USER_ID_REQUIRED');
    const payload = await client.getUser(userId);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_USER_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.userByHandleGet, async (query) => {
    const handle = normalizeText(toRecord(query).handle);
    if (!handle) throw new Error('USER_HANDLE_REQUIRED');
    const payload = await client.getUserByHandle(handle);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_USER_BY_HANDLE_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.worldByIdGet, async (query) => {
    const worldId = normalizeText(toRecord(query).worldId);
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await client.getWorld(worldId);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_WORLD_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.worldviewByIdGet, async (query) => {
    const worldId = normalizeText(toRecord(query).worldId);
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await client.getWorldview(worldId);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_WORLDVIEW_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryCoreList, async (query) => {
    return agentHandlers.agentMemoryCoreList(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryDyadicList, async (query) => {
    return agentHandlers.agentMemoryDyadicList(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryProfilesList, async (query) => {
    return agentHandlers.agentMemoryProfilesList(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryRecallForEntity, async (query) => {
    return agentHandlers.agentMemoryRecallForEntity(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryE2EList, async (query) => {
    return agentHandlers.agentMemoryE2EList(toRecord(query));
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentMemoryStatsGet, async (query) => {
    return agentHandlers.agentMemoryStatsGet(toRecord(query));
  });
}
