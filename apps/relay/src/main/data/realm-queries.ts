// Relay data queries — typed Realm service access for relay chat context.

import type { RealmModel, RealmServiceResult } from '@nimiplatform/sdk/realm';
import type {
  LocalChatTarget,
  LocalChatPlatformWarmStartMemory,
  InteractionRecallDoc,
} from '../chat-pipeline/types.js';

type JsonObject = Record<string, unknown>;

type GetAgentResult = RealmServiceResult<'AgentsService', 'getAgent'>;
type ListFriendsResult = RealmServiceResult<'MeService', 'listMyFriendsWithDetails'>;
type GetWorldResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorld'>;
type ListCoreMemoriesResult = RealmServiceResult<'AgentsService', 'agentControllerListCoreMemories'>;
type RecallForEntityResult = RealmServiceResult<'AgentsService', 'agentControllerRecallForEntity'>;
type FriendProfile = NonNullable<ListFriendsResult['items']>[number];
type AgentDna = RealmModel<'UserAgentDnaDto'>;
type AgentProfile = RealmModel<'AgentProfileDto'>;
type AgentMetadata = RealmModel<'AgentMetadataDto'>;
type AgentMemoryRecord = RealmModel<'AgentMemoryRecordDto'>;

type RelayRealmClient = {
  services: {
    AgentsService: {
      getAgent(targetId: string): Promise<GetAgentResult>;
      agentControllerListCoreMemories(targetId: string): Promise<ListCoreMemoriesResult>;
      agentControllerRecallForEntity(targetId: string, entityId: string): Promise<RecallForEntityResult>;
    };
    MeService: {
      listMyFriendsWithDetails(input?: undefined, limit?: number): Promise<ListFriendsResult>;
    };
    WorldsService: {
      worldControllerGetWorld(worldId: string): Promise<GetWorldResult>;
    };
  };
};

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  return text || null;
}

function isAgentHandle(handle: string | null): boolean {
  return Boolean(handle && handle.startsWith('~'));
}

function compactLines(values: Array<string | null | undefined>): string[] {
  return values.map((value) => normalizeText(value)).filter(Boolean);
}

function buildTargetMetadata(
  agent: AgentMetadata | undefined,
  agentProfile: AgentProfile | undefined,
  dna: AgentDna | null | undefined,
): JsonObject {
  const metadata: JsonObject = {};
  if (agent) {
    metadata.agent = agent;
  }
  if (agentProfile) {
    metadata.agentProfile = agentProfile;
  }
  if (dna) {
    metadata.dna = dna;
  }
  return metadata;
}

function buildDnaSummary(dna: AgentDna | null | undefined): LocalChatTarget['dna'] {
  const identity = dna?.identity;
  const personality = dna?.personality;
  const communication = dna?.communication;
  const appearance = dna?.appearance;

  return {
    identityLines: compactLines([
      identity?.summary,
      identity?.name ? `Name: ${identity.name}` : null,
      identity?.role ? `Role: ${identity.role}` : null,
      identity?.species ? `Species: ${identity.species}` : null,
      identity?.worldview ? `Worldview: ${identity.worldview}` : null,
    ]),
    rulesLines: compactLines([
      ...(personality?.goals ?? []).slice(0, 3).map((goal) => `Goal: ${goal}`),
      ...(personality?.interests ?? []).slice(0, 3).map((interest) => `Interest: ${interest}`),
      personality?.relationshipMode ? `Relationship mode: ${personality.relationshipMode}` : null,
    ]),
    replyStyleLines: compactLines([
      personality?.summary,
      communication?.summary,
      communication?.responseLength ? `Response length: ${communication.responseLength}` : null,
      communication?.formality ? `Formality: ${communication.formality}` : null,
      communication?.sentiment ? `Sentiment: ${communication.sentiment}` : null,
      appearance?.fashionStyle ? `Fashion style: ${appearance.fashionStyle}` : null,
    ]),
  };
}

function toMemoryTextList(records: AgentMemoryRecord[], topK: number): string[] {
  const dedupe = new Map<string, string>();
  for (const record of records) {
    const text = normalizeText(record.content);
    if (!text) continue;
    const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (!key) continue;
    if (!dedupe.has(key)) {
      dedupe.set(key, text);
    }
  }
  return Array.from(dedupe.values()).slice(0, Math.max(1, topK));
}

// ── Agent Profile ───────────────────────────────────────────────────

function normalizeAgentToTarget(payload: GetAgentResult): LocalChatTarget {
  const id = payload.id;
  const handle = normalizeText(payload.handle) || id;
  const agent = payload.agent;
  const agentProfile = payload.agentProfile;
  const dna = agentProfile?.dna;
  const worldId = normalizeOptionalText(agent?.worldId || agentProfile?.worldId);

  return {
    id,
    handle,
    displayName: normalizeText(payload.displayName) || handle,
    avatarUrl: normalizeOptionalText(payload.avatarUrl),
    bio: normalizeOptionalText(payload.bio),
    dna: buildDnaSummary(dna),
    metadata: buildTargetMetadata(agent, agentProfile, dna),
    worldId,
    worldName: null,
  };
}

/**
 * Fetches an agent profile via Realm services and normalizes to `LocalChatTarget` shape.
 */
export async function fetchTargetProfile(
  realm: RelayRealmClient,
  targetId: string,
): Promise<LocalChatTarget> {
  const payload: GetAgentResult = await realm.services.AgentsService.getAgent(targetId);
  return normalizeAgentToTarget(payload);
}

// ── Agent Friends List ──────────────────────────────────────────────

function normalizeFriendToTarget(friend: FriendProfile): LocalChatTarget | null {
  const id = normalizeText(friend.id);
  if (!id) return null;
  const handle = normalizeText(friend.handle) || id;
  const isAgent = Boolean(friend.isAgent) || isAgentHandle(handle);
  if (!isAgent) return null;
  const agent = friend.agent;
  const agentProfile = friend.agentProfile;
  const dna = agentProfile?.dna;
  const worldId = normalizeOptionalText(agent?.worldId || agentProfile?.worldId);

  return {
    id,
    handle,
    displayName: normalizeText(friend.displayName) || handle,
    avatarUrl: normalizeOptionalText(friend.avatarUrl),
    bio: normalizeOptionalText(friend.bio),
    dna: buildDnaSummary(dna),
    metadata: buildTargetMetadata(agent, agentProfile, dna),
    worldId,
    worldName: null,
  };
}

/**
 * Fetches the user's agent friends via Realm services.
 */
export async function fetchTargetList(
  realm: RelayRealmClient,
): Promise<LocalChatTarget[]> {
  const payload: ListFriendsResult = await realm.services.MeService.listMyFriendsWithDetails(undefined, 200);
  const items = payload.items ?? [];
  return items
    .map((item) => normalizeFriendToTarget(item))
    .filter((item): item is LocalChatTarget => item !== null);
}

// ── World Context ───────────────────────────────────────────────────

/**
 * Fetches world context via Realm services and returns summarized world lines.
 */
export async function fetchWorldContext(
  realm: RelayRealmClient,
  worldId: string,
): Promise<{ lines: string[] }> {
  if (!worldId) return { lines: [] };

  try {
    const payload: GetWorldResult = await realm.services.WorldsService.worldControllerGetWorld(worldId);
    const worldName = normalizeText(payload.name);
    const worldSummary = normalizeText(payload.overview || payload.description);
    const rules = (payload.truth?.rules ?? [])
      .map((rule) => normalizeText(rule.statement || rule.title))
      .filter(Boolean);

    const lines = [
      worldName ? `World: ${worldName}` : '',
      worldSummary ? `World Summary: ${worldSummary}` : '',
      ...rules.slice(0, 4).map((rule) => `World Rule: ${rule}`),
    ].filter(Boolean);

    return { lines };
  } catch (err) {
    console.warn('[relay:data] fetchWorldContext failed', { worldId }, err);
    return { lines: [] };
  }
}

// ── Platform Warm Start Memory ──────────────────────────────────────

/**
 * Fetches agent memory for warm start via typed Realm services.
 */
export async function fetchPlatformWarmStartMemory(
  realm: RelayRealmClient,
  targetId: string,
  entityId?: string,
): Promise<LocalChatPlatformWarmStartMemory | null> {
  const topK = 6;

  const [corePayload, recallPayload] = await Promise.all([
    realm.services.AgentsService.agentControllerListCoreMemories(targetId).catch((err) => {
      console.warn('[relay:data] core memory recall failed', { targetId }, err);
      return null;
    }),
    entityId
      ? realm.services.AgentsService.agentControllerRecallForEntity(targetId, entityId).catch((err: unknown) => {
          console.warn('[relay:data] entity memory recall failed', { targetId, entityId }, err);
          return null;
        })
      : Promise.resolve(null),
  ]);

  const coreMemory = toMemoryTextList(corePayload ?? [], topK);

  const e2eMemory = toMemoryTextList(recallPayload ?? [], topK);
  let resolvedEntityId: string | null = entityId || null;
  let recallSource: LocalChatPlatformWarmStartMemory['recallSource'] = 'remote-only';

  if (coreMemory.length === 0 && e2eMemory.length === 0) {
    return null;
  }

  return {
    core: coreMemory,
    e2e: e2eMemory,
    recallSource,
    entityId: resolvedEntityId,
  };
}

// ── Memory Recall ───────────────────────────────────────────────────

/**
 * Fetches memory recall for an entity via typed Realm services.
 */
export async function fetchMemoryRecall(
  realm: RelayRealmClient,
  targetId: string,
  entityId: string,
  _query: string,
): Promise<InteractionRecallDoc[]> {
  if (!entityId) return [];

  try {
    const payload = await realm.services.AgentsService.agentControllerRecallForEntity(targetId, entityId);
    return payload.map((record: AgentMemoryRecord) => ({
      id: normalizeText(record.id) || crypto.randomUUID(),
      conversationId: entityId,
      sourceTurnId: null,
      text: normalizeText(record.content),
      createdAt: normalizeText(record.createdAt) || new Date().toISOString(),
      updatedAt: normalizeText(record.createdAt) || new Date().toISOString(),
    })).filter((doc: InteractionRecallDoc) => doc.text);
  } catch (err) {
    console.warn('[relay:data] fetchMemoryRecall failed', { targetId, entityId }, err);
    return [];
  }
}
