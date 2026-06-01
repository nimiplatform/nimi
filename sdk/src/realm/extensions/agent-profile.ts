import type { Realm } from '../client.js';
import {
  isJsonObject,
  type JsonObject,
} from '../../internal/utils.js';
import { ReasonCode } from '../../types/index.js';

export type RealmAgentProfileApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type RealmAgentProfileErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type CreateRealmMasterAgentInput = {
  worldId: string;
  handle: string;
  concept: string;
  displayName?: string;
  description?: string;
  referenceImageUrl?: string;
  dnaPrimary?: 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
  dnaSecondary?: Array<'HUMOROUS' | 'SARCASTIC' | 'GENTLE' | 'DIRECT' | 'OPTIMISTIC' | 'REALISTIC' | 'DRAMATIC' | 'PASSIONATE' | 'REBELLIOUS' | 'INNOCENT' | 'WISE' | 'ECCENTRIC'>;
};

function toRecord(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function toNonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

function hasLegacyHandlePrefix(value: string): boolean {
  return value.startsWith('@') || value.startsWith('~');
}

function toNullableString(value: unknown): string | null {
  const normalized = toNonEmptyString(value);
  return normalized || null;
}

function isRealmNotFoundError(error: unknown): boolean {
  const record = toRecord(error);
  const details = toRecord(record?.details);
  const reasonCode = toNonEmptyString(record?.reasonCode) || toNonEmptyString(record?.reason_code);
  const httpStatus = Number(record?.httpStatus ?? record?.status ?? details?.httpStatus ?? details?.status);
  return reasonCode === ReasonCode.REALM_NOT_FOUND || httpStatus === 404;
}

function extractAgentWorldId(profile: JsonObject): string | null {
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
  const fromAgentProfile = toNonEmptyString(agentProfile?.worldId);
  return fromAgentProfile || null;
}

function extractWorldBannerUrl(profile: JsonObject): string | null {
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
  return toNonEmptyString(agentProfile?.worldBannerUrl) || null;
}

function extractWorldName(profile: JsonObject): string | null {
  const direct = toNonEmptyString(profile.worldName);
  if (direct) {
    return direct;
  }

  const world = toRecord(profile.world);
  const fromWorld = toNonEmptyString(world?.name);
  if (fromWorld) {
    return fromWorld;
  }

  const agentProfile = toRecord(profile.agentProfile);
  return toNonEmptyString(agentProfile?.worldName) || null;
}

export async function enrichRealmAgentProfileWithWorldBanner(
  callApi: RealmAgentProfileApiCaller,
  profile: JsonObject,
): Promise<JsonObject> {
  const existingBannerUrl = extractWorldBannerUrl(profile);
  const existingWorldName = extractWorldName(profile);
  if (existingBannerUrl && existingWorldName) {
    return profile;
  }

  const worldId = extractAgentWorldId(profile);
  if (!worldId) {
    return profile;
  }

  try {
    const world = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorld(worldId),
      'Failed to load world detail',
    );
    const worldRecord = toRecord(world);
    if (!worldRecord) {
      return profile;
    }

    return {
      ...profile,
      worldName: existingWorldName || toNullableString(worldRecord.name),
      worldBannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
      world: {
        ...(toRecord(profile.world) || {}),
        ...worldRecord,
        bannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
      },
    };
  } catch {
    return profile;
  }
}

function isRealmAgentProfile(profile: JsonObject): boolean {
  return profile.isAgent === true || Boolean(toRecord(profile.agent)) || Boolean(toRecord(profile.agentProfile));
}

async function getRealmAgentProfileById(
  callApi: RealmAgentProfileApiCaller,
  agentId: string,
): Promise<JsonObject | null> {
  const normalized = toNonEmptyString(agentId);
  if (!normalized) {
    return null;
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.AgentsService.getAgent(normalized),
      '按 id 加载 Agent 资料失败',
    );
    return toRecord(payload);
  } catch (error) {
    if (!isRealmNotFoundError(error)) {
      throw error;
    }
    return null;
  }
}

async function getRealmAgentProfileByHandle(
  callApi: RealmAgentProfileApiCaller,
  handleCandidate: string,
): Promise<JsonObject | null> {
  const normalized = toNonEmptyString(handleCandidate);
  if (!normalized) {
    return null;
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.AgentsService.getAgentByHandle(normalized),
      '按 handle 加载 Agent 资料失败',
    );
    return toRecord(payload);
  } catch (error) {
    if (!isRealmNotFoundError(error)) {
      throw error;
    }
    return null;
  }
}

export async function loadRealmAgentDetails(
  callApi: RealmAgentProfileApiCaller,
  emitRealmAgentDetailError: RealmAgentProfileErrorEmitter,
  agentIdentifier: string,
): Promise<JsonObject> {
  const normalizedIdentifier = toNonEmptyString(agentIdentifier);
  if (!normalizedIdentifier) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  if (hasLegacyHandlePrefix(normalizedIdentifier)) {
    throw new Error('HANDLE_PREFIX_UNSUPPORTED');
  }

  try {
    let profile = await getRealmAgentProfileById(callApi, normalizedIdentifier);
    if (!profile) {
      profile = await getRealmAgentProfileByHandle(callApi, normalizedIdentifier);
    }
    if (!profile || !isRealmAgentProfile(profile)) {
      throw new Error('AGENT_PROFILE_NOT_FOUND');
    }
    return await enrichRealmAgentProfileWithWorldBanner(callApi, profile);
  } catch (error) {
    emitRealmAgentDetailError('load-agent-details', error, { agentIdentifier: normalizedIdentifier });
    throw error;
  }
}

export async function createRealmMasterAgent(
  callApi: RealmAgentProfileApiCaller,
  input: CreateRealmMasterAgentInput,
): Promise<Record<string, unknown>> {
  const result = await callApi(
    (realm) => realm.services.CreatorService.creatorControllerCreateAgent({
      handle: input.handle.trim(),
      concept: input.concept.trim(),
      displayName: input.displayName?.trim() || undefined,
      description: input.description?.trim() || undefined,
      referenceImageUrl: input.referenceImageUrl?.trim() || undefined,
      dnaPrimary: input.dnaPrimary,
      dnaSecondary: input.dnaSecondary?.length ? input.dnaSecondary : undefined,
      ownershipType: 'MASTER_OWNED',
      worldId: input.worldId,
    }),
    '创建 Agent 失败',
  );
  return (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
}

export async function loadRealmCreatorAgents(
  callApi: RealmAgentProfileApiCaller,
): Promise<Record<string, unknown>[]> {
  const agents = await callApi(
    (realm) => realm.services.CreatorService.creatorControllerListAgents(),
    '加载我的 Agent 列表失败',
  );
  return Array.isArray(agents)
    ? agents.map((agent) => (agent && typeof agent === 'object' ? { ...(agent as Record<string, unknown>) } : {}))
    : [];
}
