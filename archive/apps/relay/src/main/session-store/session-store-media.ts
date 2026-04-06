import type {
  LocalChatCachedMediaArtifact,
  LocalChatMediaArtifactRecord,
} from '../chat-pipeline/types.js';
import {
  trimString,
  normalizeMediaArtifactRecord,
  cloneMediaArtifactRecord,
} from './normalizers.js';
import {
  compareIsoTimestamp,
  mediaArtifactsForConversation,
} from './session-store-helpers.js';
import {
  STORE_MEDIA_ARTIFACTS,
  getLedgerCache,
  ensureLedgerHydrated,
  persistMutation,
} from './ledger-db.js';

export async function listLocalChatMediaArtifacts(input: {
  conversationId?: string;
  turnId?: string;
  beatId?: string;
} = {}): Promise<LocalChatMediaArtifactRecord[]> {
  await ensureLedgerHydrated();
  return [...getLedgerCache().mediaArtifactsById.values()]
    .filter((artifact) => (
      (!input.conversationId || artifact.conversationId === trimString(input.conversationId))
      && (!input.turnId || artifact.turnId === trimString(input.turnId))
      && (!input.beatId || artifact.beatId === trimString(input.beatId))
    ))
    .sort((left, right) => (
      compareIsoTimestamp(right.lastHitAt, left.lastHitAt)
      || compareIsoTimestamp(right.createdAt, left.createdAt)
      || left.id.localeCompare(right.id)
    ))
    .map((artifact) => cloneMediaArtifactRecord(artifact));
}

export async function upsertLocalChatMediaArtifactRecord(
  artifact: LocalChatMediaArtifactRecord,
): Promise<LocalChatMediaArtifactRecord> {
  await ensureLedgerHydrated();
  const normalized = normalizeMediaArtifactRecord(artifact);
  if (!normalized) {
    throw new Error('LOCAL_CHAT_MEDIA_ARTIFACT_INVALID');
  }
  getLedgerCache().mediaArtifactsById.set(normalized.id, normalized);
  await persistMutation({
    puts: {
      [STORE_MEDIA_ARTIFACTS]: [normalized],
    },
  });
  return cloneMediaArtifactRecord(normalized);
}

export async function getLocalChatCachedMediaArtifact(
  executionCacheKey: string,
): Promise<LocalChatCachedMediaArtifact | null> {
  await ensureLedgerHydrated();
  const normalizedKey = trimString(executionCacheKey);
  if (!normalizedKey) return null;
  const record = [...getLedgerCache().mediaArtifactsById.values()]
    .filter((artifact) => artifact.executionCacheKey === normalizedKey)
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

export async function listLocalChatConversationMediaArtifacts(
  conversationId: string,
): Promise<LocalChatMediaArtifactRecord[]> {
  await ensureLedgerHydrated();
  return mediaArtifactsForConversation(trimString(conversationId)).map((artifact) =>
    cloneMediaArtifactRecord(artifact),
  );
}
