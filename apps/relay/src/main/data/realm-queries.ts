// Relay data queries — typed Realm service access for relay chat context.

import type { Realm, RealmServiceResult } from '@nimiplatform/sdk/realm';
import type {
  LocalChatTarget,
  LocalChatPlatformWarmStartMemory,
  InteractionRecallDoc,
} from '../chat-pipeline/types.js';

type JsonObject = Record<string, unknown>;

type GetAgentResult = RealmServiceResult<'AgentsService', 'getAgent'>;
type ListFriendsResult = RealmServiceResult<'MeService', 'listMyFriendsWithDetails'>;
type GetWorldResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorld'>;

// ── Helpers ─────────────────────────────────────────────────────────

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asNullableString(value: unknown): string | null {
  const s = String(value || '').trim();
  return s || null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function isAgentHandle(handle: string | null): boolean {
  return Boolean(handle && handle.startsWith('~'));
}

function toMemoryEntries(value: unknown): Array<string | JsonObject> {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          typeof item === 'string' ||
          (item && typeof item === 'object' && !Array.isArray(item)),
      )
      .map((item) =>
        typeof item === 'string' ? item : (item as JsonObject),
      );
  }
  const record = asRecord(value);
  if (Array.isArray(record.items)) return toMemoryEntries(record.items);
  if (Array.isArray(record.data)) return toMemoryEntries(record.data);
  return [];
}

function toMemoryText(entry: string | JsonObject): string {
  if (typeof entry === 'string') return entry.trim();
  const content = asString(
    entry.content ||
      entry.text ||
      entry.summary ||
      entry.memory ||
      entry.description ||
      entry.value,
  );
  if (content) return content;
  const fallback = JSON.stringify(entry);
  return fallback === '{}' ? '' : fallback;
}

function toMemoryTextList(
  entries: Array<string | JsonObject>,
  topK: number,
): string[] {
  const dedupe = new Map<string, string>();
  for (const entry of entries) {
    const text = toMemoryText(entry);
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

function normalizeAgentToTarget(payload: JsonObject): LocalChatTarget {
  const id = asString(payload.id);
  const handle = asString(payload.handle) || id;
  const agent = asRecord(payload.agent);
  const agentProfile = asRecord(payload.agentProfile);
  const metadata = asRecord(payload.agentMetadata || agent);
  const dna = asRecord(metadata.dna || agentProfile.dna);
  const worldId =
    asString(payload.worldId) ||
    asString(agent.worldId) ||
    asString(agentProfile.worldId) ||
    null;

  return {
    id,
    handle,
    displayName: asString(payload.displayName) || handle,
    avatarUrl: asNullableString(payload.avatarUrl),
    bio: asNullableString(payload.bio),
    dna: {
      identityLines: asStringArray(dna.identityLines),
      rulesLines: asStringArray(dna.rulesLines),
      replyStyleLines: asStringArray(dna.replyStyleLines),
    },
    metadata,
    worldId,
    worldName: asNullableString(payload.worldName),
  };
}

/**
 * Fetches an agent profile via Realm services and normalizes to `LocalChatTarget` shape.
 */
export async function fetchTargetProfile(
  realm: Realm,
  targetId: string,
): Promise<LocalChatTarget> {
  const payload: GetAgentResult = await realm.services.AgentsService.getAgent(targetId);
  return normalizeAgentToTarget(asRecord(payload));
}

// ── Agent Friends List ──────────────────────────────────────────────

function normalizeFriendToTarget(friend: JsonObject): LocalChatTarget | null {
  const id = asString(friend.id);
  if (!id) return null;
  const handle = asString(friend.handle) || id;
  const isAgent = Boolean(friend.isAgent) || isAgentHandle(handle);
  if (!isAgent) return null;

  const agent = asRecord(
    friend.agent && typeof friend.agent === 'object' ? friend.agent : friend.agentMetadata,
  );
  const agentProfile = asRecord(friend.agentProfile);
  const metadata = Object.keys(agent).length > 0 ? agent : asRecord(friend.agentMetadata);
  const dna = asRecord(metadata.dna || agentProfile.dna);

  const worldId =
    asString(friend.worldId) ||
    asString(agent.worldId) ||
    asString(agentProfile.worldId) ||
    null;

  return {
    id,
    handle,
    displayName: asString(friend.displayName) || handle,
    avatarUrl: asNullableString(friend.avatarUrl),
    bio: asNullableString(friend.bio),
    dna: {
      identityLines: asStringArray(dna.identityLines),
      rulesLines: asStringArray(dna.rulesLines),
      replyStyleLines: asStringArray(dna.replyStyleLines),
    },
    metadata,
    worldId,
    worldName: asNullableString(friend.worldName),
  };
}

/**
 * Fetches the user's agent friends via Realm services.
 */
export async function fetchTargetList(
  realm: Realm,
): Promise<LocalChatTarget[]> {
  const payload: ListFriendsResult = await realm.services.MeService.listMyFriendsWithDetails(undefined, 200);
  const record = asRecord(payload);
  const items = Array.isArray(record.items) ? record.items : [];
  return items
    .map((item) => normalizeFriendToTarget(asRecord(item)))
    .filter((item): item is LocalChatTarget => item !== null);
}

// ── World Context ───────────────────────────────────────────────────

/**
 * Fetches world context via Realm services and returns summarized world lines.
 */
export async function fetchWorldContext(
  realm: Realm,
  worldId: string,
): Promise<{ lines: string[] }> {
  if (!worldId) return { lines: [] };

  try {
    const payload: GetWorldResult = await realm.services.WorldsService.worldControllerGetWorld(worldId);
    const world = asRecord(payload);
    const worldName = asString(world.name || world.title);
    const worldSummary = asString(world.summary || world.description);
    const worldview = asRecord(world.worldview);
    const worldviewName = asString(worldview.name || worldview.title);
    const worldviewSummary = asString(worldview.summary || worldview.description);
    const rules = asStringArray(worldview.rules);

    const lines = [
      worldName ? `World: ${worldName}` : '',
      worldSummary ? `World Summary: ${worldSummary}` : '',
      worldviewName ? `Worldview: ${worldviewName}` : '',
      worldviewSummary ? `Worldview Summary: ${worldviewSummary}` : '',
      ...rules.slice(0, 4).map((rule) => `World Rule: ${rule}`),
    ].filter(Boolean);

    return { lines };
  } catch {
    return { lines: [] };
  }
}

// ── Platform Warm Start Memory ──────────────────────────────────────

/**
 * Fetches agent memory for warm start via typed Realm services.
 */
export async function fetchPlatformWarmStartMemory(
  realm: Realm,
  targetId: string,
  entityId?: string,
): Promise<LocalChatPlatformWarmStartMemory | null> {
  const topK = 6;

  const [corePayload, recallPayload] = await Promise.all([
    realm.services.AgentsService.agentControllerListCoreMemories(targetId).catch(() => null),
    entityId
      ? realm.services.AgentsService.agentControllerRecallForEntity(targetId, entityId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const coreMemory = toMemoryTextList(toMemoryEntries(corePayload), topK);

  let e2eMemory: string[] = [];
  let resolvedEntityId: string | null = entityId || null;
  let recallSource: LocalChatPlatformWarmStartMemory['recallSource'] = 'remote-only';

  if (recallPayload) {
    const response = asRecord(recallPayload);
    const entityFromResponse = asString(response.entityId);
    if (entityFromResponse) {
      resolvedEntityId = entityFromResponse;
    }
    const source = asString(response.recallSource);
    if (source === 'local-index-only') recallSource = source;
    else if (source === 'local-index+remote-backfill') recallSource = source;

    e2eMemory = toMemoryTextList(
      toMemoryEntries(response.e2e || response.e2eMemory || response.e2eMemories),
      topK,
    );
  }

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
  realm: Realm,
  targetId: string,
  entityId: string,
  _query: string,
): Promise<InteractionRecallDoc[]> {
  if (!entityId) return [];

  try {
    const payload = await realm.services.AgentsService.agentControllerRecallForEntity(targetId, entityId);

    const response = asRecord(payload);
    const rawDocs = toMemoryEntries(
      response.docs || response.items || response.data || response.memories,
    );

    return rawDocs
      .map((entry) => {
        const doc = typeof entry === 'string' ? { text: entry } : entry;
        const record = asRecord(doc);
        const id = asString(record.id) || crypto.randomUUID();
        const text = asString(record.text || record.content || record.summary);
        if (!text) return null;
        return {
          id,
          conversationId: asString(record.conversationId),
          sourceTurnId: asNullableString(record.sourceTurnId),
          text,
          createdAt: asString(record.createdAt) || new Date().toISOString(),
          updatedAt: asString(record.updatedAt) || new Date().toISOString(),
        } satisfies InteractionRecallDoc;
      })
      .filter((doc): doc is InteractionRecallDoc => doc !== null);
  } catch {
    return [];
  }
}
