import type { Realm } from '@nimiplatform/sdk/realm';
import type { DesktopChatRouteRequestDto, DesktopChatRouteResultDto } from '@runtime/chat';
import { resolveChatRouteByPolicy } from '@runtime/chat';
import { isDesktopChatRouteResultLike } from '@runtime/chat';
import { getRuntimeHookRuntime } from '@runtime/mod';
import {
  fetchAgentCoreMemorySlice,
  fetchAgentE2EMemorySlice,
  fetchAgentMemoryStats,
  fetchAgentRecallForEntity,
  type AgentMemoryRecord,
  type AgentMemoryRecallQuery,
  type AgentMemorySliceQuery,
} from '../clients/agent-memory-client';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type AgentMemoryRecallResult = {
  items: AgentMemoryRecord[];
  core: AgentMemoryRecord[];
  e2e: AgentMemoryRecord[];
};

// Module-level TTL cache for profile lookups.
const profileCache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheGet(key: string): unknown | null {
  const entry = profileCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    profileCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key: string, value: unknown, ttlMs: number) {
  profileCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function applyAgentProfileReadFilters(input: {
  emitDataSyncError: DataSyncErrorEmitter;
  viewerUserId?: string;
  worldId?: string;
  profile: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const ownerAgentId = toNonEmptyString(input.profile.id);
  if (!ownerAgentId) {
    return {
      ...input.profile,
    };
  }
  try {
    return await getRuntimeHookRuntime().invokeAgentProfileReadFilters({
      viewerUserId: input.viewerUserId,
      ownerAgentId,
      worldId: input.worldId || toNonEmptyString(input.profile.worldId),
      profile: {
        ...input.profile,
      },
    });
  } catch (error) {
    input.emitDataSyncError('load-agent-details:profile-read-filter', error, {
      ownerAgentId,
      viewerUserId: input.viewerUserId || null,
    });
    return {
      ...input.profile,
      referenceImageUrl: null,
    };
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

function isHandleIdentifier(identifier: string): boolean {
  return identifier.startsWith('@') || identifier.startsWith('~');
}

function isAgentProfile(profile: Record<string, unknown>): boolean {
  if (profile.isAgent === true) {
    return true;
  }
  const handle = toNonEmptyString(profile.handle);
  if (handle.startsWith('~')) {
    return true;
  }
  if (toRecord(profile.agent) || toRecord(profile.agentProfile)) {
    return true;
  }
  return false;
}

function extractAgentWorldId(profile: Record<string, unknown>): string {
  const direct = toNonEmptyString(profile.worldId);
  if (direct) {
    return direct;
  }
  const agent = toRecord(profile.agent);
  const fromAgent = toNonEmptyString(agent?.worldId);
  if (fromAgent) {
    return fromAgent;
  }
  const agentProfile = toRecord(profile.agentProfile);
  return toNonEmptyString(agentProfile?.worldId);
}

function extractWorldBannerUrl(profile: Record<string, unknown>): string {
  const direct = toNonEmptyString(profile.worldBannerUrl);
  if (direct) {
    return direct;
  }
  const world = toRecord(profile.world);
  const fromWorld = toNonEmptyString(world?.bannerUrl);
  if (fromWorld) {
    return fromWorld;
  }
  const agentProfile = toRecord(profile.agentProfile);
  return toNonEmptyString(agentProfile?.worldBannerUrl);
}

async function enrichAgentProfileWithWorldBanner(
  callApi: DataSyncApiCaller,
  profile: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (extractWorldBannerUrl(profile)) {
    return profile;
  }

  const worldId = extractAgentWorldId(profile);
  if (!worldId) {
    return profile;
  }

  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorld(worldId),
      'Failed to load world detail',
    );
    const world = toRecord(payload);
    const bannerUrl = toNonEmptyString(world?.bannerUrl);
    if (!world || !bannerUrl) {
      return profile;
    }
    return {
      ...profile,
      worldBannerUrl: bannerUrl,
      world: profile.world && typeof profile.world === 'object'
        ? { ...(profile.world as Record<string, unknown>), ...world, bannerUrl }
        : world,
    };
  } catch {
    return profile;
  }
}

async function getProfileByHandle(
  callApi: DataSyncApiCaller,
  handleCandidate: string,
): Promise<Record<string, unknown> | null> {
  const normalized = toNonEmptyString(handleCandidate);
  if (!normalized) {
    return null;
  }
  try {
    const payload = await callApi(
      (realm) => realm.raw.request<unknown>({
        method: 'GET',
        path: `/api/agent/handle/${encodeURIComponent(normalized)}`,
      }),
      '按 handle 加载 Agent 资料失败',
    );
    return toRecord(payload);
  } catch {
    return null;
  }
}

async function getProfileById(
  callApi: DataSyncApiCaller,
  agentId: string,
): Promise<Record<string, unknown> | null> {
  const normalized = toNonEmptyString(agentId);
  if (!normalized) {
    return null;
  }
  try {
    const payload = await callApi(
      (realm) => realm.raw.request<unknown>({
        method: 'GET',
        path: `/api/agent/accounts/${encodeURIComponent(normalized)}`,
      }),
      '按 id 加载 Agent 资料失败',
    );
    return toRecord(payload);
  } catch {
    return null;
  }
}

export async function loadAgentDetails(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  agentIdentifier: string,
  context?: {
    viewerUserId?: string;
    worldId?: string;
  },
) {
  const normalizedIdentifier = toNonEmptyString(agentIdentifier);
  if (!normalizedIdentifier) {
    throw new Error('AGENT_ID_REQUIRED');
  }

  try {
    const cacheKey = `agent-profile:${normalizedIdentifier}`;
    const cached = cacheGet(cacheKey);
    if (cached && typeof cached === 'object') {
      return applyAgentProfileReadFilters({
        emitDataSyncError,
        viewerUserId: context?.viewerUserId,
        worldId: context?.worldId,
        profile: cached as Record<string, unknown>,
      });
    }

    let profile: Record<string, unknown> | null = null;

    if (isHandleIdentifier(normalizedIdentifier)) {
      const candidates = [
        normalizedIdentifier,
        normalizedIdentifier.slice(1),
      ].filter((item, index, list) => Boolean(item) && list.indexOf(item) === index);

      for (const candidate of candidates) {
        profile = await getProfileByHandle(callApi, candidate);
        if (profile) {
          break;
        }
      }
    } else {
      profile = await getProfileById(callApi, normalizedIdentifier);
      if (!profile) {
        profile = await getProfileByHandle(callApi, normalizedIdentifier);
      }
    }

    if (!profile || !isAgentProfile(profile)) {
      throw new Error('AGENT_PROFILE_NOT_FOUND');
    }
    profile = await enrichAgentProfileWithWorldBanner(callApi, profile);

    const resolvedId = toNonEmptyString(profile.id);
    if (resolvedId) {
      cacheSet(`agent-profile:${resolvedId}`, profile, 5 * 60 * 1000);
    }
    const resolvedHandle = toNonEmptyString(profile.handle);
    if (resolvedHandle) {
      cacheSet(`agent-profile:${resolvedHandle}`, profile, 5 * 60 * 1000);
      if (!resolvedHandle.startsWith('~') && !resolvedHandle.startsWith('@')) {
        cacheSet(`agent-profile:~${resolvedHandle}`, profile, 5 * 60 * 1000);
        cacheSet(`agent-profile:@${resolvedHandle}`, profile, 5 * 60 * 1000);
      }
    }
    cacheSet(cacheKey, profile, 5 * 60 * 1000);
    return applyAgentProfileReadFilters({
      emitDataSyncError,
      viewerUserId: context?.viewerUserId,
      worldId: context?.worldId,
      profile,
    });
  } catch (error) {
    emitDataSyncError('load-agent-details', error, { agentIdentifier: normalizedIdentifier });
    throw error;
  }
}

export async function loadAgentMemoryStats(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  agentId: string,
) {
  try {
    return await callApi(
      (realm) => fetchAgentMemoryStats(realm, { agentId }),
      '加载 Agent 记忆统计失败',
    );
  } catch (error) {
    emitDataSyncError('load-agent-memory-stats', error, { agentId });
    throw error;
  }
}

export async function listAgentCoreMemories(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: {
    agentId: string;
    query?: AgentMemorySliceQuery;
  },
): Promise<AgentMemoryRecord[]> {
  const agentId = toNonEmptyString(input.agentId);
  if (!agentId) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  try {
    const response = await callApi(
      (realm) => fetchAgentCoreMemorySlice(realm, {
        agentId,
        query: input.query,
      }),
      '加载 Agent Core 记忆失败',
    );
    return response.items;
  } catch (error) {
    emitDataSyncError('list-agent-core-memories', error, { agentId });
    throw error;
  }
}

export async function listAgentE2EMemories(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: {
    agentId: string;
    entityId: string;
    query?: AgentMemorySliceQuery;
  },
): Promise<AgentMemoryRecord[]> {
  const agentId = toNonEmptyString(input.agentId);
  const entityId = toNonEmptyString(input.entityId);
  if (!agentId) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  if (!entityId) {
    throw new Error('ENTITY_ID_REQUIRED');
  }
  try {
    const response = await callApi(
      (realm) => fetchAgentE2EMemorySlice(realm, {
        agentId,
        entityId,
        query: input.query,
      }),
      '加载 Agent E2E 记忆失败',
    );
    return response.items;
  } catch (error) {
    emitDataSyncError('list-agent-e2e-memories', error, { agentId, entityId });
    throw error;
  }
}

export async function recallAgentMemoryForEntity(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: {
    agentId: string;
    entityId: string;
    query?: AgentMemoryRecallQuery;
  },
): Promise<AgentMemoryRecallResult> {
  const agentId = toNonEmptyString(input.agentId);
  const entityId = toNonEmptyString(input.entityId);
  if (!agentId) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  if (!entityId) {
    throw new Error('ENTITY_ID_REQUIRED');
  }
  try {
    const response = await callApi(
      (realm) => fetchAgentRecallForEntity(realm, {
        agentId,
        entityId,
        query: input.query,
      }),
      '召回 Agent 记忆失败',
    );
    return {
      items: response.items,
      core: response.core,
      e2e: response.e2e,
    };
  } catch (error) {
    emitDataSyncError('recall-agent-memory-for-entity', error, { agentId, entityId });
    throw error;
  }
}

export async function resolveChatRoute(
  callApi: DataSyncApiCaller,
  data: DesktopChatRouteRequestDto,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<DesktopChatRouteResultDto> {
  try {
    const route = await callApi(
      async (realm) => {
        const payload = await realm.raw.request<unknown>({
          method: 'POST',
          path: '/api/desktop/chat/route',
          body: data,
        });

        if (!isDesktopChatRouteResultLike(payload)) {
          throw new Error('desktop route API returned invalid payload');
        }

        return payload;
      },
      '解析聊天路由失败',
    );

    return route;
  } catch (error) {
    const fallbackRoute = resolveChatRouteByPolicy(data);
    emitDataSyncError('resolve-chat-route', error, {
      targetType: data.targetType,
      fallback: true,
    });
    return fallbackRoute;
  }
}
