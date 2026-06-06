import type {
  CreateAgentDto,
  RealmTypedCallOptions,
  RealmTypedClient,
  UserLiteDto,
  UserProfileDto,
  WorldDetailDto,
} from '../core-generated/realm-typed-client';
import { ReasonCode, createNimiError, extractNimiErrorFields, type JsonObject } from '../types';

export type NimiRealmAgentProfileProjection = JsonObject & UserProfileDto & {
  readonly worldName?: string | null;
  readonly worldBannerUrl?: string | null;
  readonly world?: JsonObject | null;
};
export type NimiRealmCreatorAgentProjection = UserLiteDto;
export type NimiRealmCreateMasterAgentInput = {
  readonly worldId: string;
  readonly handle: string;
  readonly concept: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly referenceImageUrl?: string;
  readonly dnaPrimary?: CreateAgentDto['dnaPrimary'];
  readonly dnaSecondary?: CreateAgentDto['dnaSecondary'];
};

export interface NimiRealmAgentProfileApi {
  readonly agents: Pick<
    RealmTypedClient,
    | 'creatorControllerCreateAgent'
    | 'creatorControllerListAgents'
    | 'getAgent'
    | 'getAgentByHandle'
  >;
  readonly world: Pick<RealmTypedClient, 'worldControllerGetWorld'>;
}

export async function enrichNimiRealmAgentProfileWithWorldBanner(
  realm: Pick<NimiRealmAgentProfileApi, 'world'>,
  profile: NimiRealmAgentProfileProjection,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmAgentProfileProjection> {
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
    const world = await realm.world.worldControllerGetWorld({ path: { id: worldId } }, options);
    const worldRecord = toRecord(world);
    if (!worldRecord) {
      return profile;
    }

    return {
      ...profile,
      worldName: existingWorldName || toNullableString((world as WorldDetailDto).name),
      worldBannerUrl: existingBannerUrl || toNullableString((world as WorldDetailDto).bannerUrl),
      world: {
        ...(toRecord(profile.world) || {}),
        ...worldRecord,
        bannerUrl: existingBannerUrl || toNullableString((world as WorldDetailDto).bannerUrl),
      },
    } as unknown as NimiRealmAgentProfileProjection;
  } catch {
    return profile;
  }
}

export async function loadNimiRealmAgentDetails(
  realm: NimiRealmAgentProfileApi,
  agentIdentifier: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmAgentProfileProjection> {
  const normalizedIdentifier = toNonEmptyString(agentIdentifier);
  if (!normalizedIdentifier) {
    throw agentProfileError('AGENT_ID_REQUIRED', 'Realm agent identifier is required.');
  }
  if (hasLegacyHandlePrefix(normalizedIdentifier)) {
    throw agentProfileError('HANDLE_PREFIX_UNSUPPORTED', 'Realm agent handle prefixes are not supported.');
  }

  let profile = await getNimiRealmAgentProfileById(realm, normalizedIdentifier, options);
  if (!profile) {
    profile = await getNimiRealmAgentProfileByHandle(realm, normalizedIdentifier, options);
  }
  if (!profile || !isNimiRealmAgentProfile(profile)) {
    throw agentProfileError('AGENT_PROFILE_NOT_FOUND', 'Realm agent profile was not found.');
  }
  return enrichNimiRealmAgentProfileWithWorldBanner(realm, profile, options);
}

export async function createNimiRealmMasterAgent(
  realm: NimiRealmAgentProfileApi,
  input: NimiRealmCreateMasterAgentInput,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmCreatorAgentProjection> {
  const body: CreateAgentDto = {
    handle: input.handle.trim(),
    concept: input.concept.trim(),
    worldId: input.worldId.trim(),
    ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.referenceImageUrl?.trim() ? { referenceImageUrl: input.referenceImageUrl.trim() } : {}),
    ...(input.dnaPrimary ? { dnaPrimary: input.dnaPrimary } : {}),
    ...(input.dnaSecondary?.length ? { dnaSecondary: input.dnaSecondary } : {}),
    ownershipType: 'MASTER_OWNED',
  };
  if (!body.handle || !body.concept || !body.worldId) {
    throw agentProfileError('AGENT_CREATE_INPUT_INVALID', 'Realm master agent create input is incomplete.');
  }
  return realm.agents.creatorControllerCreateAgent({ path: {}, body }, options);
}

export async function loadNimiRealmCreatorAgents(
  realm: NimiRealmAgentProfileApi,
  options?: RealmTypedCallOptions,
): Promise<readonly NimiRealmCreatorAgentProjection[]> {
  const agents = await realm.agents.creatorControllerListAgents({ path: {} }, options);
  return Array.isArray(agents) ? agents : [];
}

async function getNimiRealmAgentProfileById(
  realm: NimiRealmAgentProfileApi,
  agentId: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmAgentProfileProjection | null> {
  try {
    const payload = await realm.agents.getAgent({ path: { id: agentId } }, options);
    return toProfileProjection(payload);
  } catch (error) {
    if (!isNimiRealmNotFoundError(error)) {
      throw error;
    }
    return null;
  }
}

async function getNimiRealmAgentProfileByHandle(
  realm: NimiRealmAgentProfileApi,
  handle: string,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmAgentProfileProjection | null> {
  try {
    const payload = await realm.agents.getAgentByHandle({ path: { handle } }, options);
    return toProfileProjection(payload);
  } catch (error) {
    if (!isNimiRealmNotFoundError(error)) {
      throw error;
    }
    return null;
  }
}

function toProfileProjection(value: unknown): NimiRealmAgentProfileProjection | null {
  const record = toRecord(value);
  return record ? record as unknown as NimiRealmAgentProfileProjection : null;
}

function toRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
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

function extractAgentWorldId(profile: unknown): string | null {
  const record = toRecord(profile);
  if (!record) return null;
  const direct = toNonEmptyString(record.worldId);
  if (direct) return direct;
  const agent = toRecord(record.agent);
  const fromAgent = toNonEmptyString(agent?.worldId);
  if (fromAgent) return fromAgent;
  const agentProfile = toRecord(record.agentProfile);
  return toNonEmptyString(agentProfile?.worldId) || null;
}

function extractWorldBannerUrl(profile: unknown): string | null {
  const record = toRecord(profile);
  if (!record) return null;
  const direct = toNonEmptyString(record.worldBannerUrl);
  if (direct) return direct;
  const world = toRecord(record.world);
  const fromWorld = toNonEmptyString(world?.bannerUrl);
  if (fromWorld) return fromWorld;
  const agentProfile = toRecord(record.agentProfile);
  return toNonEmptyString(agentProfile?.worldBannerUrl) || null;
}

function extractWorldName(profile: unknown): string | null {
  const record = toRecord(profile);
  if (!record) return null;
  const direct = toNonEmptyString(record.worldName);
  if (direct) return direct;
  const world = toRecord(record.world);
  const fromWorld = toNonEmptyString(world?.name);
  if (fromWorld) return fromWorld;
  const agentProfile = toRecord(record.agentProfile);
  return toNonEmptyString(agentProfile?.worldName) || null;
}

function isNimiRealmAgentProfile(profile: unknown): boolean {
  const record = toRecord(profile);
  return Boolean(record && (record.isAgent === true || toRecord(record.agent) || toRecord(record.agentProfile)));
}

function isNimiRealmNotFoundError(error: unknown): boolean {
  const fields = extractNimiErrorFields(error);
  if (fields.reasonCode === ReasonCode.REALM_NOT_FOUND) {
    return true;
  }
  const record = toRecord(error);
  const details = toRecord(record?.details);
  const httpStatus = Number(record?.httpStatus ?? record?.status ?? details?.httpStatus ?? details?.status);
  return httpStatus === 404;
}

function agentProfileError(reasonCode: string, message: string): Error {
  return createNimiError({
    message,
    reasonCode,
    actionHint: 'check_realm_agent_profile_projection',
    source: 'sdk',
  });
}
