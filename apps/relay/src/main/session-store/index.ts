// Relay session store — adapted from local-chat session-store/index.ts; uses LedgerDb as storage backend.
import type {
  ChatMessage,
  ChatMessageMeta,
  LocalChatCachedMediaAsset,
  LocalChatMediaArtifactShadow,
  LocalChatMediaGenerationSpec,
  InteractionRecallDoc,
  InteractionSnapshot,
  LocalChatConversationRecord,
  LocalChatMediaAssetRecord,
  LocalChatPromptTrace,
  LocalChatSession,
  LocalChatStoredBeat,
  LocalChatTurn,
  LocalChatTurnAudit,
  LocalChatTurnRecord,
  LocalChatTurnWithBeats,
  RelationMemorySlot,
} from '../chat-pipeline/types.js';
import { createUlid } from '../chat-pipeline/ulid.js';
import {
  nowIso,
  trimString,
  asIsoString,
  normalizeConversationRecord,
  normalizeTurnRecord,
  normalizeBeatRecord,
  normalizeInteractionSnapshot,
  normalizeRelationMemorySlot,
  normalizeInteractionRecallDoc,
  normalizeMediaAssetRecord,
  normalizeCachedMediaAsset,
  cloneConversation,
  cloneTurnRecord,
  cloneStoredBeat,
  cloneInteractionSnapshot,
  cloneRelationMemorySlot,
  cloneInteractionRecallDoc,
  cloneMediaAssetRecord,
} from './normalizers.js';
import {
  EXACT_HISTORY_TURN_LIMIT,
  buildConversationRecord,
  beatsForTurn,
  buildProjectionSession,
  buildTurnRecord,
  buildTurnWithBeats,
  compareIsoTimestamp,
  createProjectionTurnFromMessage,
  findConversationForScope,
  latestAuditFromSession,
  latestTraceFromSession,
  matchesViewerId,
  mediaAssetsForConversation,
  projectConversationToSession,
  projectBeatToTurn,
  turnsForConversation,
  type BeatInsertInput,
  type CreateConversationInput,
  type TurnRecordInsertInput,
} from './session-store-helpers.js';
import {
  LOCAL_CHAT_SESSION_UPDATED_EVENT,
  STORE_BEATS,
  STORE_CONVERSATIONS,
  STORE_INTERACTION_SNAPSHOTS,
  STORE_MEDIA_ASSETS,
  STORE_RECALL_INDEX,
  STORE_RELATION_MEMORY_SLOTS,
  STORE_TURNS,
  getLedgerCache,
  resetLedgerCache,
  clearLedgerPersistence,
  ensureLedgerHydrated,
  persistMutation,
  emitSessionUpdated,
} from './ledger-db.js';
import {
  lexicalScore,
  findBestRelationMemoryMatch,
  shouldResolveRelationMemorySlot,
  pruneRelationMemorySlots,
  withPreservedOverride,
} from './relation-memory.js';
export type {
  InteractionRecallDoc,
  InteractionSnapshot,
  LocalChatConversationRecord,
  LocalChatMediaAssetRecord,
  LocalChatPromptTrace,
  LocalChatSession,
  LocalChatStoredBeat,
  LocalChatTurn,
  LocalChatTurnAudit,
  LocalChatTurnRecord,
  LocalChatTurnWithBeats,
  RelationMemorySlot,
};
export type LocalChatTargetPreview = {
  targetId: string;
  latestLocalMessage: string | null;
  latestLocalMessageAt: string | null;
};
// ── Public API ──────────────────────────────────────────────────────
export function isSyncableRelationMemorySlot(slot: Pick<RelationMemorySlot, 'portability' | 'sensitivity' | 'userOverride'>): boolean {
  return slot.portability === 'portable'
    && slot.sensitivity !== 'intimate'
    && slot.userOverride !== 'never-sync';
}
export function getLocalChatSessionUpdatedEventName(): string {
  return LOCAL_CHAT_SESSION_UPDATED_EVENT;
}
export function warmUpLedgerHydration(): void {
  void ensureLedgerHydrated();
}
export async function resetLocalChatConversationLedgerForTests(): Promise<void> {
  resetLedgerCache();
  await clearLedgerPersistence();
}
export async function listLocalChatSessions(targetId: string, viewerId?: string): Promise<LocalChatSession[]> {
  await ensureLedgerHydrated();
  const normalizedTargetId = trimString(targetId);
  if (!normalizedTargetId) return [];
  const normalizedViewerId = trimString(viewerId);
  if (normalizedViewerId) {
    const scopedConversation = findConversationForScope({
      targetId: normalizedTargetId,
      viewerId: normalizedViewerId,
    });
    return scopedConversation
      ? [buildProjectionSession(projectConversationToSession(scopedConversation))]
      : [];
  }
  return [...getLedgerCache().conversationsById.values()]
    .filter((conversation) => (
      conversation.targetId === normalizedTargetId
      && matchesViewerId(conversation.viewerId, viewerId)
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((conversation) => buildProjectionSession(projectConversationToSession(conversation)));
}

export async function listAllLocalChatSessions(viewerId?: string): Promise<LocalChatSession[]> {
  await ensureLedgerHydrated();
  return [...getLedgerCache().conversationsById.values()]
    .filter((conversation) => matchesViewerId(conversation.viewerId, viewerId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((conversation) => buildProjectionSession(projectConversationToSession(conversation)));
}

export async function getSessionById(sessionId: string, viewerId?: string): Promise<LocalChatSession | null> {
  await ensureLedgerHydrated();
  const conversation = getLedgerCache().conversationsById.get(trimString(sessionId));
  if (!conversation || !matchesViewerId(conversation.viewerId, viewerId)) return null;
  return buildProjectionSession(projectConversationToSession(conversation));
}

export async function getLocalChatConversationRecord(sessionId: string, viewerId?: string): Promise<LocalChatConversationRecord | null> {
  await ensureLedgerHydrated();
  const conversation = getLedgerCache().conversationsById.get(trimString(sessionId));
  if (!conversation || !matchesViewerId(conversation.viewerId, viewerId)) return null;
  return cloneConversation(conversation);
}

export async function listLocalChatTurnRecords(conversationId: string, viewerId?: string): Promise<LocalChatTurnWithBeats[]> {
  await ensureLedgerHydrated();
  const conversation = getLedgerCache().conversationsById.get(trimString(conversationId));
  if (!conversation || !matchesViewerId(conversation.viewerId, viewerId)) return [];
  return turnsForConversation(conversation.id).map((turn) => buildTurnWithBeats(turn));
}

export async function listLocalChatExactHistoryTurns(conversationId: string, viewerId?: string): Promise<LocalChatTurn[]> {
  const turns = await listLocalChatTurnRecords(conversationId, viewerId);
  return turns
    .filter((turn) => turn.beats.length > 0)
    .slice(-EXACT_HISTORY_TURN_LIMIT)
    .flatMap((turn) => turn.beats.map((beat) => projectBeatToTurn(turn, beat)));
}

export async function createLocalChatSession(input: CreateConversationInput): Promise<LocalChatSession> {
  await ensureLedgerHydrated();
  const targetId = trimString(input.targetId);
  const viewerId = trimString(input.viewerId) || 'viewer';
  const existing = findConversationForScope({
    targetId,
    viewerId,
  });
  if (existing) {
    return buildProjectionSession(projectConversationToSession(existing));
  }
  const conversation = buildConversationRecord({
    ...input,
    targetId,
    viewerId,
  });
  getLedgerCache().conversationsById.set(conversation.id, conversation);
  await persistMutation({
    puts: {
      [STORE_CONVERSATIONS]: [conversation],
    },
  });
  emitSessionUpdated({
    targetId: conversation.targetId,
    sessionId: conversation.id,
  });
  return projectConversationToSession(conversation);
}

export async function deleteLocalChatSession(sessionId: string): Promise<void> {
  await ensureLedgerHydrated();
  const ledgerCache = getLedgerCache();
  const conversation = ledgerCache.conversationsById.get(trimString(sessionId));
  if (!conversation) return;
  ledgerCache.conversationsById.delete(conversation.id);

  const turnIds = turnsForConversation(conversation.id).map((turn) => turn.id);
  const beatIds = [...ledgerCache.beatsById.values()]
    .filter((beat) => beat.conversationId === conversation.id)
    .map((beat) => beat.id);
  const mediaAssetIds = [...ledgerCache.mediaAssetsById.values()]
    .filter((asset) => asset.conversationId === conversation.id)
    .map((asset) => asset.id);
  const recallIndexIds = [...ledgerCache.recallIndexById.values()]
    .filter((doc) => doc.conversationId === conversation.id)
    .map((doc) => doc.id);

  turnIds.forEach((turnId) => ledgerCache.turnsById.delete(turnId));
  beatIds.forEach((beatId) => ledgerCache.beatsById.delete(beatId));
  mediaAssetIds.forEach((assetId) => ledgerCache.mediaAssetsById.delete(assetId));
  ledgerCache.interactionSnapshotsByConversationId.delete(conversation.id);
  recallIndexIds.forEach((docId) => ledgerCache.recallIndexById.delete(docId));

  await persistMutation({
    deletes: {
      [STORE_CONVERSATIONS]: [conversation.id],
      [STORE_TURNS]: turnIds,
      [STORE_BEATS]: beatIds,
      [STORE_MEDIA_ASSETS]: mediaAssetIds,
      [STORE_INTERACTION_SNAPSHOTS]: [conversation.id],
      [STORE_RECALL_INDEX]: recallIndexIds,
    },
  });
  emitSessionUpdated({
    targetId: conversation.targetId,
    sessionId: conversation.id,
  });
}

export async function clearSession(sessionId: string): Promise<void> {
  await ensureLedgerHydrated();
  const ledgerCache = getLedgerCache();
  const conversation = ledgerCache.conversationsById.get(trimString(sessionId));
  if (!conversation) return;

  const turnIds = turnsForConversation(conversation.id).map((turn) => turn.id);
  const beatIds = [...ledgerCache.beatsById.values()]
    .filter((beat) => beat.conversationId === conversation.id)
    .map((beat) => beat.id);
  const mediaAssetIds = [...ledgerCache.mediaAssetsById.values()]
    .filter((asset) => asset.conversationId === conversation.id)
    .map((asset) => asset.id);

  turnIds.forEach((turnId) => ledgerCache.turnsById.delete(turnId));
  beatIds.forEach((beatId) => ledgerCache.beatsById.delete(beatId));
  mediaAssetIds.forEach((assetId) => ledgerCache.mediaAssetsById.delete(assetId));

  const nextConversation: LocalChatConversationRecord = {
    ...conversation,
    lastTurnSeq: 0,
    updatedAt: nowIso(),
  };
  ledgerCache.conversationsById.set(nextConversation.id, nextConversation);

  await persistMutation({
    puts: {
      [STORE_CONVERSATIONS]: [nextConversation],
    },
    deletes: {
      [STORE_TURNS]: turnIds,
      [STORE_BEATS]: beatIds,
      [STORE_MEDIA_ASSETS]: mediaAssetIds,
    },
  });
  emitSessionUpdated({
    targetId: nextConversation.targetId,
    sessionId: nextConversation.id,
  });
}

export async function createLocalChatTurnRecord(input: TurnRecordInsertInput): Promise<LocalChatTurnRecord> {
  await ensureLedgerHydrated();
  const ledgerCache = getLedgerCache();
  const conversation = ledgerCache.conversationsById.get(trimString(input.conversationId));
  if (!conversation) {
    throw new Error('LOCAL_CHAT_CONVERSATION_NOT_FOUND');
  }
  const turn = {
    ...buildTurnRecord(input, conversation.lastTurnSeq),
    conversationId: conversation.id,
    beatCount: Number.isFinite(input.beatCount) && Number(input.beatCount) > 0
      ? Math.floor(Number(input.beatCount))
      : 0,
  };
  const createdAt = turn.createdAt;
  ledgerCache.turnsById.set(turn.id, turn);
  const nextConversation: LocalChatConversationRecord = {
    ...conversation,
    lastTurnSeq: Math.max(conversation.lastTurnSeq, turn.seq),
    updatedAt: createdAt,
  };
  ledgerCache.conversationsById.set(nextConversation.id, nextConversation);
  await persistMutation({
    puts: {
      [STORE_TURNS]: [turn],
      [STORE_CONVERSATIONS]: [nextConversation],
    },
  });
  emitSessionUpdated({
    targetId: nextConversation.targetId,
    sessionId: nextConversation.id,
  });
  return cloneTurnRecord(turn);
}

export async function appendBeatToLocalChatTurn(input: BeatInsertInput): Promise<LocalChatStoredBeat> {
  await ensureLedgerHydrated();
  const ledgerCache = getLedgerCache();
  const conversation = ledgerCache.conversationsById.get(trimString(input.conversationId));
  const turn = ledgerCache.turnsById.get(trimString(input.turnId));
  if (!conversation || !turn || turn.conversationId !== conversation.id) {
    throw new Error('LOCAL_CHAT_TURN_NOT_FOUND');
  }
  const beatId = trimString(input.beatId) || `beat_${createUlid()}`;
  const existingBeat = ledgerCache.beatsById.get(beatId);
  if (existingBeat && existingBeat.turnId !== turn.id) {
    throw new Error('LOCAL_CHAT_BEAT_TURN_MISMATCH');
  }
  const timestamp = asIsoString(input.timestamp, nowIso());
  const priorBeats = beatsForTurn(turn.id);
  const beatIndex = Number.isFinite(input.beatIndex) && Number(input.beatIndex) >= 0
    ? Math.floor(Number(input.beatIndex))
    : existingBeat?.beatIndex ?? priorBeats.length;
  const explicitBeatCount = Number.isFinite(input.beatCount) && Number(input.beatCount) > 0
    ? Math.floor(Number(input.beatCount))
    : 0;
  const beatCount = Math.max(
    explicitBeatCount,
    existingBeat?.beatCount || 0,
    turn.beatCount,
    beatIndex + 1,
  ) || 1;

  const beat: LocalChatStoredBeat = {
    id: beatId,
    turnId: turn.id,
    turnSeq: turn.seq,
    conversationId: conversation.id,
    role: input.role,
    beatIndex,
    beatCount,
    kind: input.kind,
    deliveryStatus: input.deliveryStatus || existingBeat?.deliveryStatus || 'ready',
    content: String(input.content || ''),
    contextText: String(input.contextText || input.content || ''),
    semanticSummary: trimString(input.semanticSummary) || null,
    mediaSpec: input.mediaSpec === undefined ? existingBeat?.mediaSpec : input.mediaSpec,
    mediaShadow: input.mediaShadow === undefined ? existingBeat?.mediaShadow : input.mediaShadow,
    media: input.media === undefined ? existingBeat?.media : input.media,
    timestamp,
    latencyMs: input.latencyMs === undefined ? existingBeat?.latencyMs : input.latencyMs,
    meta: input.meta === undefined ? existingBeat?.meta : input.meta,
    promptTrace: input.promptTrace === undefined ? existingBeat?.promptTrace : (input.promptTrace || undefined),
    audit: input.audit === undefined ? existingBeat?.audit : (input.audit || undefined),
  };

  const nextTurn: LocalChatTurnRecord = {
    ...turn,
    updatedAt: timestamp,
    beatCount: Math.max(turn.beatCount, beatCount),
  };
  const nextConversation: LocalChatConversationRecord = {
    ...conversation,
    updatedAt: timestamp,
    lastTurnSeq: Math.max(conversation.lastTurnSeq, turn.seq),
  };

  ledgerCache.beatsById.set(beat.id, beat);
  ledgerCache.turnsById.set(nextTurn.id, nextTurn);
  ledgerCache.conversationsById.set(nextConversation.id, nextConversation);
  await persistMutation({
    puts: {
      [STORE_BEATS]: [beat],
      [STORE_TURNS]: [nextTurn],
      [STORE_CONVERSATIONS]: [nextConversation],
    },
  });
  emitSessionUpdated({
    targetId: nextConversation.targetId,
    sessionId: nextConversation.id,
  });
  return cloneStoredBeat(beat);
}

export async function patchLocalChatBeatArtifacts(input: {
  sessionId: string;
  beatId: string;
  promptTrace?: LocalChatPromptTrace | null;
  audit?: LocalChatTurnAudit | null;
  contextText?: string;
  semanticSummary?: string | null;
  deliveryStatus?: LocalChatStoredBeat['deliveryStatus'];
  media?: LocalChatStoredBeat['media'];
  meta?: ChatMessageMeta;
  mediaSpec?: LocalChatMediaGenerationSpec;
  mediaShadow?: LocalChatMediaArtifactShadow;
}): Promise<LocalChatSession | null> {
  await ensureLedgerHydrated();
  const ledgerCache = getLedgerCache();
  const conversation = ledgerCache.conversationsById.get(trimString(input.sessionId));
  const beat = ledgerCache.beatsById.get(trimString(input.beatId));
  if (!conversation || !beat || beat.conversationId !== conversation.id) return null;
  const nextBeat: LocalChatStoredBeat = {
    ...beat,
    promptTrace: input.promptTrace === undefined ? beat.promptTrace : (input.promptTrace || undefined),
    audit: input.audit === undefined ? beat.audit : (input.audit || undefined),
    contextText: input.contextText === undefined ? beat.contextText : input.contextText,
    semanticSummary: input.semanticSummary === undefined ? beat.semanticSummary : (input.semanticSummary || null),
    deliveryStatus: input.deliveryStatus || beat.deliveryStatus,
    mediaSpec: input.mediaSpec === undefined ? beat.mediaSpec : input.mediaSpec,
    mediaShadow: input.mediaShadow === undefined ? beat.mediaShadow : input.mediaShadow,
    media: input.media === undefined ? beat.media : input.media,
    meta: input.meta === undefined ? beat.meta : input.meta,
  };
  const turn = ledgerCache.turnsById.get(beat.turnId);
  const timestamp = nowIso();
  const nextTurn = turn ? {
    ...turn,
    updatedAt: timestamp,
  } : null;
  const nextConversation: LocalChatConversationRecord = {
    ...conversation,
    updatedAt: timestamp,
  };

  ledgerCache.beatsById.set(nextBeat.id, nextBeat);
  if (nextTurn) {
    ledgerCache.turnsById.set(nextTurn.id, nextTurn);
  }
  ledgerCache.conversationsById.set(nextConversation.id, nextConversation);
  await persistMutation({
    puts: {
      [STORE_BEATS]: [nextBeat],
      ...(nextTurn ? { [STORE_TURNS]: [nextTurn] } : {}),
      [STORE_CONVERSATIONS]: [nextConversation],
    },
  });
  emitSessionUpdated({
    targetId: nextConversation.targetId,
    sessionId: nextConversation.id,
  });
  return projectConversationToSession(nextConversation);
}

export async function appendTurnsToSession(sessionId: string, turns: LocalChatTurn[]): Promise<LocalChatSession | null> {
  await ensureLedgerHydrated();
  const conversation = getLedgerCache().conversationsById.get(trimString(sessionId));
  if (!conversation) return null;
  const grouped = new Map<string, LocalChatTurn[]>();
  for (const turn of turns) {
    const key = trimString(turn.turnId) || trimString(turn.id);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(turn);
    } else {
      grouped.set(key, [turn]);
    }
  }
  let currentConversation = conversation;
  for (const group of [...grouped.values()].sort((left, right) => {
    const leftSeq = left[0]?.turnSeq || 0;
    const rightSeq = right[0]?.turnSeq || 0;
    return leftSeq - rightSeq || String(left[0]?.timestamp || '').localeCompare(String(right[0]?.timestamp || ''));
  })) {
    const lead = group[0];
    if (!lead) continue;
    const turnRecord = await createLocalChatTurnRecord({
      conversationId: currentConversation.id,
      role: lead.role,
      turnTxnId: null,
      turnId: lead.turnId || lead.id,
      seq: lead.turnSeq > 0 ? lead.turnSeq : undefined,
      createdAt: lead.timestamp,
      beatCount: Math.max(...group.map((item) => item.beatCount || 1), 1),
    });
    const orderedBeats = [...group].sort((left, right) => (
      left.beatIndex - right.beatIndex
      || left.timestamp.localeCompare(right.timestamp)
      || left.id.localeCompare(right.id)
    ));
    for (const beat of orderedBeats) {
      await appendBeatToLocalChatTurn({
        conversationId: currentConversation.id,
        turnId: turnRecord.id,
        role: beat.role,
        kind: beat.kind,
        content: beat.content,
        contextText: beat.contextText || beat.content,
        semanticSummary: beat.semanticSummary || null,
        mediaSpec: beat.mediaSpec,
        mediaShadow: beat.mediaShadow,
        media: beat.media,
        timestamp: beat.timestamp,
        latencyMs: beat.latencyMs,
        meta: beat.meta,
        promptTrace: beat.promptTrace || null,
        audit: beat.audit || null,
        deliveryStatus: beat.meta?.mediaStatus === 'pending'
          ? 'pending'
          : beat.meta?.mediaStatus === 'failed'
            ? 'failed'
            : beat.meta?.mediaStatus === 'blocked'
              ? 'blocked'
              : 'ready',
        beatId: beat.id,
        beatIndex: beat.beatIndex,
        beatCount: beat.beatCount,
      });
    }
    currentConversation = getLedgerCache().conversationsById.get(currentConversation.id)!;
  }
  return projectConversationToSession(currentConversation);
}

export async function getInteractionSnapshot(conversationId: string): Promise<InteractionSnapshot | null> {
  await ensureLedgerHydrated();
  const snapshot = getLedgerCache().interactionSnapshotsByConversationId.get(trimString(conversationId));
  return snapshot ? cloneInteractionSnapshot(snapshot) : null;
}

export async function updateInteractionSnapshot(snapshot: InteractionSnapshot): Promise<InteractionSnapshot> {
  await ensureLedgerHydrated();
  const normalized = normalizeInteractionSnapshot(snapshot) || {
    ...snapshot,
    updatedAt: snapshot.updatedAt || nowIso(),
  };
  getLedgerCache().interactionSnapshotsByConversationId.set(normalized.conversationId, normalized);
  await persistMutation({
    puts: {
      [STORE_INTERACTION_SNAPSHOTS]: [normalized],
    },
  });
  return cloneInteractionSnapshot(normalized);
}

export async function getRelationMemorySlots(input: {
  targetId: string;
  viewerId: string;
}): Promise<RelationMemorySlot[]> {
  await ensureLedgerHydrated();
  return [...getLedgerCache().relationMemorySlotsById.values()]
    .filter((entry) => (
      entry.targetId === trimString(input.targetId)
      && entry.viewerId === trimString(input.viewerId)
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((entry) => cloneRelationMemorySlot(entry));
}

export async function updateRelationMemorySlots(input: {
  targetId: string;
  viewerId: string;
  entries: RelationMemorySlot[];
  resolutionTexts?: string[];
  maxEntries?: number;
}): Promise<RelationMemorySlot[]> {
  await ensureLedgerHydrated();
  const ledgerCache = getLedgerCache();
  const targetId = trimString(input.targetId);
  const viewerId = trimString(input.viewerId);
  const normalizedEntries = input.entries
    .map((entry) => normalizeRelationMemorySlot(entry))
    .filter((entry): entry is RelationMemorySlot => Boolean(entry))
    .filter((entry) => entry.targetId === targetId && entry.viewerId === viewerId);
  const resolutionTexts = (input.resolutionTexts || []).map(trimString).filter(Boolean);
  const maxEntries = Number.isFinite(input.maxEntries) && Number(input.maxEntries) > 0
    ? Math.floor(Number(input.maxEntries))
    : 50;
  const existing = [...ledgerCache.relationMemorySlotsById.values()]
    .filter((entry) => entry.targetId === targetId && entry.viewerId === viewerId)
    .map((entry) => cloneRelationMemorySlot(entry));

  const deletedIds = new Set<string>();
  let merged = existing.filter((entry) => {
    if (!shouldResolveRelationMemorySlot(entry, resolutionTexts)) {
      return true;
    }
    deletedIds.add(entry.id);
    return false;
  });

  const putEntries = new Map<string, RelationMemorySlot>();
  for (const normalizedEntry of normalizedEntries) {
    const matched = findBestRelationMemoryMatch(merged, normalizedEntry);
    if (matched) {
      const nextEntry = withPreservedOverride({
        ...matched,
        ...normalizedEntry,
        id: matched.id,
      }, matched);
      merged = merged.map((entry) => entry.id === matched.id ? nextEntry : entry);
      putEntries.set(nextEntry.id, nextEntry);
      continue;
    }
    const nextEntry = withPreservedOverride({
      ...normalizedEntry,
      id: trimString(normalizedEntry.id) || `slot_${createUlid()}`,
    });
    merged.push(nextEntry);
    putEntries.set(nextEntry.id, nextEntry);
  }

  const { kept, removed } = pruneRelationMemorySlots(merged, maxEntries);
  removed.forEach((entry) => {
    deletedIds.add(entry.id);
    putEntries.delete(entry.id);
  });

  for (const entry of existing) {
    if (deletedIds.has(entry.id)) {
      ledgerCache.relationMemorySlotsById.delete(entry.id);
    }
  }
  kept.forEach((entry) => {
    ledgerCache.relationMemorySlotsById.set(entry.id, entry);
  });

  await persistMutation({
    puts: putEntries.size > 0
      ? {
        [STORE_RELATION_MEMORY_SLOTS]: [...putEntries.values()],
      }
      : undefined,
    deletes: deletedIds.size > 0
      ? {
        [STORE_RELATION_MEMORY_SLOTS]: [...deletedIds],
      }
      : undefined,
  });

  return kept
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((entry) => cloneRelationMemorySlot(entry));
}

export async function getRecallIndex(conversationId: string): Promise<InteractionRecallDoc[]> {
  await ensureLedgerHydrated();
  return [...getLedgerCache().recallIndexById.values()]
    .filter((doc) => doc.conversationId === trimString(conversationId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((doc) => cloneInteractionRecallDoc(doc));
}

export async function updateRecallIndex(input: {
  conversationId: string;
  docs: InteractionRecallDoc[];
}): Promise<void> {
  await ensureLedgerHydrated();
  const ledgerCache = getLedgerCache();
  const conversationId = trimString(input.conversationId);
  const deleted: string[] = [];
  for (const [id, doc] of ledgerCache.recallIndexById.entries()) {
    if (doc.conversationId !== conversationId) continue;
    ledgerCache.recallIndexById.delete(id);
    deleted.push(id);
  }
  const normalized = input.docs
    .map((doc) => normalizeInteractionRecallDoc(doc))
    .filter((doc): doc is InteractionRecallDoc => Boolean(doc));
  normalized.forEach((doc) => {
    ledgerCache.recallIndexById.set(doc.id, doc);
  });
  await persistMutation({
    puts: {
      [STORE_RECALL_INDEX]: normalized,
    },
    deletes: {
      [STORE_RECALL_INDEX]: deleted,
    },
  });
}

export async function getLatestLocalChatArtifacts(sessionId: string, viewerId?: string): Promise<{
  promptTrace: LocalChatPromptTrace | null;
  audit: LocalChatTurnAudit | null;
}> {
  const session = await getSessionById(sessionId, viewerId);
  return {
    promptTrace: latestTraceFromSession(session),
    audit: latestAuditFromSession(session),
  };
}

export function createSessionTurn(input: {
  message: ChatMessage;
  promptTrace?: LocalChatPromptTrace | null;
  audit?: LocalChatTurnAudit | null;
}): LocalChatTurn {
  return createProjectionTurnFromMessage(input.message, input.promptTrace, input.audit);
}

export async function searchLocalChatRecallIndex(input: {
  conversationId: string;
  query: string;
  limit?: number;
}): Promise<InteractionRecallDoc[]> {
  const docs = await getRecallIndex(input.conversationId);
  const query = trimString(input.query);
  if (!query) return docs.slice(0, input.limit || 8);
  return docs
    .map((doc) => ({
      doc,
      score: lexicalScore(doc.text, query),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || right.doc.updatedAt.localeCompare(left.doc.updatedAt)
    ))
    .slice(0, input.limit || 8)
    .map((item) => item.doc);
}

export async function listLocalChatMediaAssets(input: {
  conversationId?: string;
  turnId?: string;
  beatId?: string;
} = {}): Promise<LocalChatMediaAssetRecord[]> {
  await ensureLedgerHydrated();
  return [...getLedgerCache().mediaAssetsById.values()]
    .filter((asset) => (
      (!input.conversationId || asset.conversationId === trimString(input.conversationId))
      && (!input.turnId || asset.turnId === trimString(input.turnId))
      && (!input.beatId || asset.beatId === trimString(input.beatId))
    ))
    .sort((left, right) => (
      compareIsoTimestamp(right.lastHitAt, left.lastHitAt)
      || compareIsoTimestamp(right.createdAt, left.createdAt)
      || left.id.localeCompare(right.id)
    ))
    .map((asset) => cloneMediaAssetRecord(asset));
}

export async function upsertLocalChatMediaAssetRecord(asset: LocalChatMediaAssetRecord): Promise<LocalChatMediaAssetRecord> {
  await ensureLedgerHydrated();
  const normalized = normalizeMediaAssetRecord(asset);
  if (!normalized) {
    throw new Error('LOCAL_CHAT_MEDIA_ASSET_INVALID');
  }
  getLedgerCache().mediaAssetsById.set(normalized.id, normalized);
  await persistMutation({
    puts: {
      [STORE_MEDIA_ASSETS]: [normalized],
    },
  });
  return cloneMediaAssetRecord(normalized);
}

export async function getLocalChatCachedMediaAsset(executionCacheKey: string): Promise<LocalChatCachedMediaAsset | null> {
  await ensureLedgerHydrated();
  const normalizedKey = trimString(executionCacheKey);
  if (!normalizedKey) return null;
  const record = [...getLedgerCache().mediaAssetsById.values()]
    .filter((asset) => asset.executionCacheKey === normalizedKey)
    .sort((left, right) => (
      compareIsoTimestamp(right.lastHitAt, left.lastHitAt)
      || compareIsoTimestamp(right.createdAt, left.createdAt)
      || left.id.localeCompare(right.id)
    ))[0];
  if (!record) return null;
  return {
    executionCacheKey: record.executionCacheKey,
    specHash: record.specHash,
    kind: record.kind,
    renderUri: record.renderUri,
    mimeType: record.mimeType,
    routeSource: record.routeSource,
    ...(record.connectorId ? { connectorId: record.connectorId } : {}),
    ...(record.model ? { model: record.model } : {}),
    createdAt: record.createdAt,
    lastHitAt: record.lastHitAt,
  };
}

export async function listLocalChatConversationMediaAssets(conversationId: string): Promise<LocalChatMediaAssetRecord[]> {
  await ensureLedgerHydrated();
  return mediaAssetsForConversation(trimString(conversationId)).map((asset) => cloneMediaAssetRecord(asset));
}
