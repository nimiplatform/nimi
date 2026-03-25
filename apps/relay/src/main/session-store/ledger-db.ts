import type {
  InteractionRecallDoc,
  InteractionSnapshot,
  LocalChatConversationRecord,
  LocalChatMediaArtifactRecord,
  LocalChatStoredBeat,
  LocalChatTurnRecord,
  RelationMemorySlot,
} from '../chat-pipeline/types.js';
import {
  normalizeBeatRecord,
  normalizeConversationRecord,
  normalizeInteractionRecallDoc,
  normalizeInteractionSnapshot,
  normalizeMediaArtifactRecord,
  normalizeRelationMemorySlot,
  normalizeTurnRecord,
} from './normalizers.js';
import type { RelayChatStorage } from './relay-chat-storage.js';
import { createRelayChatStorage } from './relay-chat-storage.js';

// Legacy schema ids are retained for continuity, but runtime persistence now uses host-backed storage snapshots.
export const LOCAL_CHAT_LEDGER_DB_NAME = 'nimi.local-chat.ledger.v3';
export const LOCAL_CHAT_LEDGER_DB_VERSION = 1;
export const LOCAL_CHAT_SESSION_UPDATED_EVENT = 'local-chat:session-updated';
export const LEGACY_LOCAL_CHAT_SESSION_STORE_KEY = 'nimi.local-chat.sessions.v2';
export const STORE_CONVERSATIONS = 'conversations';
export const STORE_TURNS = 'turns';
export const STORE_BEATS = 'beats';
export const STORE_MEDIA_ARTIFACTS = 'mediaArtifacts';
export const STORE_INTERACTION_SNAPSHOTS = 'interactionSnapshots';
export const STORE_RELATION_MEMORY_SLOTS = 'relationMemorySlots';
export const STORE_RECALL_INDEX = 'recallIndex';

const LEDGER_SNAPSHOT_KEY = 'ledger-snapshot';

export type StoreName =
  | typeof STORE_CONVERSATIONS
  | typeof STORE_TURNS
  | typeof STORE_BEATS
  | typeof STORE_MEDIA_ARTIFACTS
  | typeof STORE_INTERACTION_SNAPSHOTS
  | typeof STORE_RELATION_MEMORY_SLOTS
  | typeof STORE_RECALL_INDEX;

export type LedgerCache = {
  hydrated: boolean;
  conversationsById: Map<string, LocalChatConversationRecord>;
  turnsById: Map<string, LocalChatTurnRecord>;
  beatsById: Map<string, LocalChatStoredBeat>;
  mediaArtifactsById: Map<string, LocalChatMediaArtifactRecord>;
  interactionSnapshotsByConversationId: Map<string, InteractionSnapshot>;
  relationMemorySlotsById: Map<string, RelationMemorySlot>;
  recallIndexById: Map<string, InteractionRecallDoc>;
};

export type LedgerMutation = {
  puts?: Partial<Record<StoreName, unknown[]>>;
  deletes?: Partial<Record<StoreName, string[]>>;
};

type PersistedLedgerSnapshot = {
  conversations: unknown[];
  turns: unknown[];
  beats: unknown[];
  mediaArtifacts: unknown[];
  interactionSnapshots: unknown[];
  relationMemorySlots: unknown[];
  recallIndex: unknown[];
};

let ledgerStateStore: RelayChatStorage | null = null;

function getLedgerStateStore(): RelayChatStorage {
  if (!ledgerStateStore) {
    ledgerStateStore = createRelayChatStorage('local-chat.ledger');
  }
  return ledgerStateStore;
}

function emptyLedgerCache(): LedgerCache {
  return {
    hydrated: false,
    conversationsById: new Map(),
    turnsById: new Map(),
    beatsById: new Map(),
    mediaArtifactsById: new Map(),
    interactionSnapshotsByConversationId: new Map(),
    relationMemorySlotsById: new Map(),
    recallIndexById: new Map(),
  };
}

let ledgerCache: LedgerCache = emptyLedgerCache();
let hydratePromise: Promise<void> | null = null;

export function getLedgerCache(): LedgerCache {
  return ledgerCache;
}

export function resetLedgerCache(): void {
  ledgerCache = emptyLedgerCache();
}

function serializeLedgerSnapshot(): PersistedLedgerSnapshot {
  return {
    conversations: Array.from(ledgerCache.conversationsById.values()),
    turns: Array.from(ledgerCache.turnsById.values()),
    beats: Array.from(ledgerCache.beatsById.values()),
    mediaArtifacts: Array.from(ledgerCache.mediaArtifactsById.values()),
    interactionSnapshots: Array.from(ledgerCache.interactionSnapshotsByConversationId.values()),
    relationMemorySlots: Array.from(ledgerCache.relationMemorySlotsById.values()),
    recallIndex: Array.from(ledgerCache.recallIndexById.values()),
  };
}

async function persistLedgerSnapshot(): Promise<void> {
  await getLedgerStateStore().setJson(LEDGER_SNAPSHOT_KEY, serializeLedgerSnapshot());
}

function applyPersistedSnapshot(snapshot: PersistedLedgerSnapshot | null | undefined): void {
  ledgerCache = emptyLedgerCache();
  (snapshot?.conversations || [])
    .map((item) => normalizeConversationRecord(item))
    .filter((item): item is LocalChatConversationRecord => Boolean(item))
    .forEach((item) => {
      ledgerCache.conversationsById.set(item.id, item);
    });
  (snapshot?.turns || [])
    .map((item) => normalizeTurnRecord(item))
    .filter((item): item is LocalChatTurnRecord => Boolean(item))
    .forEach((item) => {
      ledgerCache.turnsById.set(item.id, item);
    });
  (snapshot?.beats || [])
    .map((item) => normalizeBeatRecord(item))
    .filter((item): item is LocalChatStoredBeat => Boolean(item))
    .forEach((item) => {
      ledgerCache.beatsById.set(item.id, item);
    });
  (snapshot?.mediaArtifacts || [])
    .map((item) => normalizeMediaArtifactRecord(item))
    .filter((item): item is LocalChatMediaArtifactRecord => Boolean(item))
    .forEach((item) => {
      ledgerCache.mediaArtifactsById.set(item.id, item);
    });
  (snapshot?.interactionSnapshots || [])
    .map((item) => normalizeInteractionSnapshot(item))
    .filter((item): item is InteractionSnapshot => Boolean(item))
    .forEach((item) => {
      ledgerCache.interactionSnapshotsByConversationId.set(item.conversationId, item);
    });
  (snapshot?.relationMemorySlots || [])
    .map((item) => normalizeRelationMemorySlot(item))
    .filter((item): item is RelationMemorySlot => Boolean(item))
    .forEach((item) => {
      ledgerCache.relationMemorySlotsById.set(item.id, item);
    });
  (snapshot?.recallIndex || [])
    .map((item) => normalizeInteractionRecallDoc(item))
    .filter((item): item is InteractionRecallDoc => Boolean(item))
    .forEach((item) => {
      ledgerCache.recallIndexById.set(item.id, item);
    });
  ledgerCache.hydrated = true;
}

export async function openLedgerDatabase(): Promise<boolean> {
  await getLedgerStateStore().get(LEDGER_SNAPSHOT_KEY);
  return true;
}

export async function loadAllFromHostStorageSnapshot(): Promise<void> {
  const snapshot = await getLedgerStateStore().getJson<PersistedLedgerSnapshot>(LEDGER_SNAPSHOT_KEY);
  applyPersistedSnapshot(snapshot);
}

export async function ensureLedgerHydrated(): Promise<void> {
  if (ledgerCache.hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = loadAllFromHostStorageSnapshot().finally(() => {
    hydratePromise = null;
  });
  return hydratePromise;
}

export function emitSessionUpdated(_payload: { targetId: string; sessionId: string }): void {
  // In Electron main process there is no window/CustomEvent.
  // Session update notifications are handled via IPC to the renderer instead.
}

function applyMutationRows<T>(
  target: Map<string, T>,
  rows: unknown[] | undefined,
  normalize: (value: unknown) => T | null,
  keyOf: (value: T) => string,
): void {
  for (const row of rows || []) {
    const normalized = normalize(row);
    if (!normalized) {
      continue;
    }
    target.set(keyOf(normalized), normalized);
  }
}

function deleteMutationRows<T>(target: Map<string, T>, keys: string[] | undefined): void {
  for (const key of keys || []) {
    target.delete(String(key || '').trim());
  }
}

export async function persistMutation(mutation: LedgerMutation): Promise<void> {
  await ensureLedgerHydrated();
  applyMutationRows(
    ledgerCache.conversationsById,
    mutation.puts?.[STORE_CONVERSATIONS],
    normalizeConversationRecord,
    (value) => value.id,
  );
  applyMutationRows(
    ledgerCache.turnsById,
    mutation.puts?.[STORE_TURNS],
    normalizeTurnRecord,
    (value) => value.id,
  );
  applyMutationRows(
    ledgerCache.beatsById,
    mutation.puts?.[STORE_BEATS],
    normalizeBeatRecord,
    (value) => value.id,
  );
  applyMutationRows(
    ledgerCache.mediaArtifactsById,
    mutation.puts?.[STORE_MEDIA_ARTIFACTS],
    normalizeMediaArtifactRecord,
    (value) => value.id,
  );
  applyMutationRows(
    ledgerCache.interactionSnapshotsByConversationId,
    mutation.puts?.[STORE_INTERACTION_SNAPSHOTS],
    normalizeInteractionSnapshot,
    (value) => value.conversationId,
  );
  applyMutationRows(
    ledgerCache.relationMemorySlotsById,
    mutation.puts?.[STORE_RELATION_MEMORY_SLOTS],
    normalizeRelationMemorySlot,
    (value) => value.id,
  );
  applyMutationRows(
    ledgerCache.recallIndexById,
    mutation.puts?.[STORE_RECALL_INDEX],
    normalizeInteractionRecallDoc,
    (value) => value.id,
  );

  deleteMutationRows(ledgerCache.conversationsById, mutation.deletes?.[STORE_CONVERSATIONS]);
  deleteMutationRows(ledgerCache.turnsById, mutation.deletes?.[STORE_TURNS]);
  deleteMutationRows(ledgerCache.beatsById, mutation.deletes?.[STORE_BEATS]);
  deleteMutationRows(ledgerCache.mediaArtifactsById, mutation.deletes?.[STORE_MEDIA_ARTIFACTS]);
  deleteMutationRows(ledgerCache.interactionSnapshotsByConversationId, mutation.deletes?.[STORE_INTERACTION_SNAPSHOTS]);
  deleteMutationRows(ledgerCache.relationMemorySlotsById, mutation.deletes?.[STORE_RELATION_MEMORY_SLOTS]);
  deleteMutationRows(ledgerCache.recallIndexById, mutation.deletes?.[STORE_RECALL_INDEX]);

  await persistLedgerSnapshot();
}

export async function clearLedgerPersistence(): Promise<void> {
  ledgerCache = emptyLedgerCache();
  await getLedgerStateStore().delete(LEDGER_SNAPSHOT_KEY);
}

export async function transactionDone(): Promise<void> {
  return;
}

export async function requestToPromise<T>(value: T): Promise<T> {
  return value;
}
