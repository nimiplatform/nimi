import {
  listAgentDyadicMemories,
  listAgentCoreMemories,
  type AgentMemoryRecord,
} from '@nimiplatform/sdk/realm';
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
};

type AgentChatRouteResult = {
  channel: 'CLOUD' | 'LOCAL';
  providerSelectable: boolean;
  reason: string;
  sessionClass: 'AGENT_LOCAL' | 'HUMAN_DIRECT';
};

type AgentCoreDataClient = {
  getCurrentUser: () => Promise<unknown>;
  resolveAgentChatRoute: (agentId: string) => Promise<unknown>;
  listAgentCoreMemories: (agentId: string, query?: AgentMemorySliceQuery) => Promise<AgentMemoryRecord[]>;
  listAgentDyadicMemories: (
    agentId: string,
    userId: string,
    query?: AgentMemorySliceQuery,
  ) => Promise<AgentMemoryRecord[]>;
  listAgentMemoryProfiles: (agentId: string) => Promise<unknown>;
  listMyFriendsWithDetails: (limit?: number) => Promise<unknown>;
  getUser: (userId: string) => Promise<unknown>;
  getUserByHandle: (handle: string) => Promise<unknown>;
  getWorld: (worldId: string) => Promise<unknown>;
  getWorldview: (worldId: string) => Promise<unknown>;
};

function createAgentCoreDataClient(): AgentCoreDataClient {
  return {
    getCurrentUser: () => withRuntimeOpenApiContext((realm) => realm.services.MeService.getMe()),
    resolveAgentChatRoute: (agentId) => withRuntimeOpenApiContext((realm) => (
      realm.services.DesktopService.desktopControllerResolveChatRoute({
        targetType: 'AGENT',
        agentId,
      })
    )),
    listAgentCoreMemories: (agentId, query) => withRuntimeOpenApiContext((realm) => (
      listAgentCoreMemories(realm, {
        agentId,
        limit: query?.limit,
      })
    )),
    listAgentDyadicMemories: (agentId, userId, query) => withRuntimeOpenApiContext((realm) => (
      listAgentDyadicMemories(realm, {
        agentId,
        userId,
        limit: query?.limit,
      })
    )),
    listAgentMemoryProfiles: async (_agentId) => {
      throw new Error('AGENT_MEMORY_PROFILES_UNAVAILABLE');
    },
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
  const record = toRecord(item);
  const content = String(item.content || record.text || record.summary || '').trim();
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
  dyadicByUser: Map<string, AgentMemoryRecord[]>;
  loadedDyadicUsers: Set<string>;
  updatedAt: number;
};

const MEMORY_LOCAL_INDEX_TTL_MS = 5 * 60 * 1000;
const memoryLocalIndex = new Map<string, MemoryIndexEntry>();
let currentUserIdCache: { userId: string; expiresAt: number } | null = null;

function getMemoryIndex(agentId: string): MemoryIndexEntry | undefined {
  const current = memoryLocalIndex.get(agentId);
  if (!current) return undefined;
  if (Date.now() - current.updatedAt > MEMORY_LOCAL_INDEX_TTL_MS) {
    return undefined;
  }
  return current;
}

function upsertMemoryIndex(input: {
  agentId: string;
  core?: AgentMemoryRecord[];
  userId?: string;
  dyadic?: AgentMemoryRecord[];
}): MemoryIndexEntry {
  const previous = memoryLocalIndex.get(input.agentId);
  const next: MemoryIndexEntry = {
    core: previous?.core || [],
    hasCoreSlice: previous?.hasCoreSlice === true,
    dyadicByUser: previous?.dyadicByUser || new Map<string, AgentMemoryRecord[]>(),
    loadedDyadicUsers: previous?.loadedDyadicUsers || new Set<string>(),
    updatedAt: Date.now(),
  };

  if (Array.isArray(input.core)) {
    next.core = dedupeMemory(input.core);
    next.hasCoreSlice = true;
  }

  if (input.userId && Array.isArray(input.dyadic)) {
    next.dyadicByUser.set(input.userId, dedupeMemory(input.dyadic));
    next.loadedDyadicUsers.add(input.userId);
  }

  memoryLocalIndex.set(input.agentId, next);
  return next;
}

async function resolveCurrentUserIdWith(client: AgentCoreDataClient): Promise<string> {
  const cached = currentUserIdCache;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  const payload = await client.getCurrentUser();
  const userId = String(toRecord(payload).id || '').trim();
  if (!userId) {
    throw new Error('CURRENT_USER_ID_CONTRACT_INVALID');
  }
  currentUserIdCache = {
    userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  return userId;
}

async function resolveUserId(
  query: Record<string, unknown>,
  resolveCurrentUserIdFn: () => Promise<string | undefined>,
): Promise<string | undefined> {
  const explicit = String(query.userId || query.entityId || query.subjectId || '').trim();
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

async function loadRemoteCoreMemories(
  client: AgentCoreDataClient,
  agentId: string,
  query?: AgentMemorySliceQuery,
): Promise<AgentMemoryRecord[]> {
  return client.listAgentCoreMemories(agentId, query);
}

async function loadRemoteDyadicMemories(input: {
  client: AgentCoreDataClient;
  agentId: string;
  userId: string;
  query?: AgentMemorySliceQuery;
}): Promise<AgentMemoryRecord[]> {
  return input.client.listAgentDyadicMemories(input.agentId, input.userId, input.query);
}

type AgentCoreDataCapabilityDeps = {
  client?: Partial<AgentCoreDataClient>;
  resolveCurrentUserId?: () => Promise<string | undefined>;
};

export type AgentCoreDataCapabilityHandlers = {
  agentChatRouteResolve: (query: Record<string, unknown>) => Promise<AgentChatRouteResult>;
  agentMemoryCoreList: (query: Record<string, unknown>) => Promise<{ items: AgentMemoryRecord[]; source: 'local-index-only' | 'remote-only' }>;
  agentMemoryDyadicList: (query: Record<string, unknown>) => Promise<{ items: AgentMemoryRecord[]; source: 'local-index-only' | 'remote-only'; userId: string }>;
  agentMemoryProfilesList: (_query: Record<string, unknown>) => Promise<{ items: Record<string, unknown>[] } & Record<string, unknown>>;
};

function requireAgentId(query: Record<string, unknown>): string {
  const agentId = String(query.agentId || query.id || '').trim();
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

export function resetAgentCoreDataStateForTesting(): void {
  memoryLocalIndex.clear();
  currentUserIdCache = null;
}

export function seedAgentMemoryIndexForTesting(input: {
  agentId: string;
  core?: AgentMemoryRecord[];
  userId?: string;
  dyadic?: AgentMemoryRecord[];
}): void {
  upsertMemoryIndex(input);
}

export function createAgentCoreDataCapabilityHandlers(
  deps: AgentCoreDataCapabilityDeps = {},
): AgentCoreDataCapabilityHandlers {
  const client: AgentCoreDataClient = {
    ...createAgentCoreDataClient(),
    ...(deps.client || {}),
  };
  const resolveCurrentUserIdFn = deps.resolveCurrentUserId ?? (() => resolveCurrentUserIdWith(client));

  return {
    agentChatRouteResolve: async (query) => {
      const agentId = requireAgentId(toRecord(query));
      const payload = await client.resolveAgentChatRoute(agentId);
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

      const remoteItems = await loadRemoteCoreMemories(client, agentId, memoryQuery);
      upsertMemoryIndex({ agentId, core: remoteItems });
      return {
        items: remoteItems,
        source: 'remote-only' as const,
      };
    },

    agentMemoryDyadicList: async (query) => {
      const queryRecord = toRecord(query);
      const agentId = requireAgentId(queryRecord);
      const userId = await requireUserId(queryRecord, resolveCurrentUserIdFn);
      const memoryQuery = toMemorySliceQuery(queryRecord);
      const localIndex = getMemoryIndex(agentId);
      if (localIndex?.loadedDyadicUsers.has(userId)) {
        const localItems = localIndex.dyadicByUser.get(userId) || [];
        const limit = memoryQuery?.limit || localItems.length;
        return {
          items: takeTop(localItems, limit),
          source: 'local-index-only' as const,
          userId,
        };
      }

      const remoteItems = await loadRemoteDyadicMemories({
        client,
        agentId,
        userId,
        query: memoryQuery,
      });
      upsertMemoryIndex({
        agentId,
        userId,
        dyadic: remoteItems,
      });
      return {
        items: remoteItems,
        source: 'remote-only' as const,
        userId,
      };
    },

    agentMemoryProfilesList: async (query) => {
      const agentId = requireAgentId(toRecord(query));
      const payload = await client.listAgentMemoryProfiles(agentId);
      const result = requireItemsPayload(
        payload as { items?: unknown[] } & Record<string, unknown>,
        'AGENT_MEMORY_PROFILES_CONTRACT_INVALID',
      );
      return {
        ...result,
        items: result.items
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
          .map((item) => item),
      };
    },
  };
}

export async function registerCoreDataCapabilities(): Promise<void> {
  const client = createAgentCoreDataClient();
  const agentHandlers = createAgentCoreDataCapabilityHandlers({ client });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.friendsWithDetailsList, async () => {
    const payload = await client.listMyFriendsWithDetails(100);
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'CORE_FRIENDS_WITH_DETAILS_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.userByIdGet, async (query) => {
    const userId = String(toRecord(query).userId || '').trim();
    if (!userId) throw new Error('USER_ID_REQUIRED');
    const payload = await client.getUser(userId);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_USER_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.userByHandleGet, async (query) => {
    const handle = String(toRecord(query).handle || '').trim();
    if (!handle) throw new Error('USER_HANDLE_REQUIRED');
    const payload = await client.getUserByHandle(handle);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_USER_BY_HANDLE_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.worldByIdGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await client.getWorld(worldId);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_WORLD_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.worldviewByIdGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await client.getWorldview(worldId);
    return requireObjectPayload(payload as Record<string, unknown>, 'CORE_WORLDVIEW_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(CORE_DATA_API_CAPABILITIES.agentChatRouteResolve, async (query) => {
    return agentHandlers.agentChatRouteResolve(toRecord(query));
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
}
