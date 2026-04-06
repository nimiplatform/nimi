import type {
  ChatMessageMeta,
  LocalChatCachedMediaArtifact,
  LocalChatMediaArtifactShadow,
  LocalChatMediaGenerationSpec,
} from '../chat-pipeline/types.js';
import type {
  InteractionRecallDoc,
  InteractionSnapshot,
  LocalChatConversationRecord,
  LocalChatContextTrace,
  LocalChatMediaArtifactRecord,
  LocalChatPromptTrace,
  LocalChatStoredBeat,
  LocalChatTurnAudit,
  LocalChatTurnRecord,
  RelationMemorySlot,
} from '../chat-pipeline/types.js';
import { createUlid } from '../chat-pipeline/ulid.js';
import { asRecord } from '../../shared/json.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export function trimString(value: unknown): string {
  return String(value || '').trim();
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asIsoString(value: unknown, fallback: string): string {
  const normalized = trimString(value);
  return normalized || fallback;
}

export function normalizeBeatKind(value: unknown): LocalChatStoredBeat['kind'] {
  return value === 'voice' || value === 'image' || value === 'video' ? value : 'text';
}

export function normalizeDeliveryStatus(value: unknown): LocalChatStoredBeat['deliveryStatus'] {
  return value === 'pending' || value === 'blocked' || value === 'failed' ? value : 'ready';
}

export function normalizeBeatMedia(value: unknown): LocalChatStoredBeat['media'] {
  if (!value || typeof value !== 'object') return undefined;
  const media = asRecord(value);
  const normalized: LocalChatStoredBeat['media'] = {};
  const uri = trimString(media.uri);
  const mimeType = trimString(media.mimeType);
  const previewUri = trimString(media.previewUri);
  const width = Number(media.width);
  const height = Number(media.height);
  const durationSeconds = Number(media.durationSeconds);
  if (uri) normalized.uri = uri;
  if (mimeType) normalized.mimeType = mimeType;
  if (previewUri) normalized.previewUri = previewUri;
  if (Number.isFinite(width) && width > 0) normalized.width = Math.round(width);
  if (Number.isFinite(height) && height > 0) normalized.height = Math.round(height);
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) normalized.durationSeconds = durationSeconds;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeContextTrace(value: unknown): LocalChatContextTrace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as LocalChatContextTrace;
}

export function normalizeMediaSpec(value: unknown): LocalChatMediaGenerationSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as LocalChatMediaGenerationSpec;
}

export function normalizeMediaShadow(value: unknown): LocalChatMediaArtifactShadow | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as LocalChatMediaArtifactShadow;
}

export function normalizeCachedMediaArtifact(value: unknown): LocalChatCachedMediaArtifact | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const executionCacheKey = trimString(record.executionCacheKey);
  const specHash = trimString(record.specHash);
  const renderUri = trimString(record.renderUri);
  const mimeType = trimString(record.mimeType);
  if (!executionCacheKey || !specHash || !renderUri || !mimeType) {
    return null;
  }
  const createdAt = asIsoString(record.createdAt, nowIso());
  return {
    executionCacheKey,
    specHash,
    kind: record.kind === 'video' ? 'video' : 'image',
    renderUri,
    mimeType,
    routeSource: record.routeSource === 'cloud' ? 'cloud' : 'local',
    ...(trimString(record.connectorId) ? { connectorId: trimString(record.connectorId) } : {}),
    ...(trimString(record.model) ? { model: trimString(record.model) } : {}),
    createdAt,
    lastHitAt: asIsoString(record.lastHitAt, createdAt),
  };
}

export function normalizeMediaArtifactRecord(value: unknown): LocalChatMediaArtifactRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const cached = normalizeCachedMediaArtifact(record);
  if (!cached) return null;
  return {
    ...cached,
    id: trimString(record.id) || `artifact_${createUlid()}`,
    conversationId: trimString(record.conversationId) || null,
    turnId: trimString(record.turnId) || null,
    beatId: trimString(record.beatId) || null,
  };
}

export function normalizeTurnAudit(value: unknown): LocalChatTurnAudit | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = asRecord(value);
  return {
    id: trimString(record.id) || `audit_${createUlid()}`,
    targetId: trimString(record.targetId),
    worldId: trimString(record.worldId) || null,
    latencyMs: Number(record.latencyMs) || 0,
    error: trimString(record.error) || null,
    createdAt: asIsoString(record.createdAt, nowIso()),
  };
}

export function normalizeInteractionSnapshot(value: unknown): InteractionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const conversationId = trimString(record.conversationId);
  if (!conversationId) return null;
  const updatedAt = asIsoString(record.updatedAt, nowIso());
  const relationshipStateRaw = trimString(record.relationshipState);
  const relationshipState: InteractionSnapshot['relationshipState'] = relationshipStateRaw === 'friendly'
    || relationshipStateRaw === 'warm'
    || relationshipStateRaw === 'intimate'
    ? relationshipStateRaw
    : 'new';
  const emotionalTemperatureRaw = trimString(record.emotionalTemperature);
  const emotionalTemperature: InteractionSnapshot['emotionalTemperature'] = emotionalTemperatureRaw === 'steady'
    || emotionalTemperatureRaw === 'warm'
    || emotionalTemperatureRaw === 'heated'
    ? emotionalTemperatureRaw
    : 'low';
  return {
    conversationId,
    relationshipState,
    activeScene: asArray(record.activeScene).map(trimString).filter(Boolean),
    emotionalTemperature,
    assistantCommitments: asArray(record.assistantCommitments).map(trimString).filter(Boolean),
    userPrefs: asArray(record.userPrefs).map(trimString).filter(Boolean),
    openLoops: asArray(record.openLoops).map(trimString).filter(Boolean),
    topicThreads: asArray(record.topicThreads).map(trimString).filter(Boolean),
    lastResolvedTurnId: trimString(record.lastResolvedTurnId) || null,
    conversationDirective: trimString(record.conversationDirective) || null,
    updatedAt,
  };
}

export function normalizeRelationMemorySlot(value: unknown): RelationMemorySlot | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const id = trimString(record.id);
  const targetId = trimString(record.targetId);
  const viewerId = trimString(record.viewerId);
  const slotType = trimString(record.slotType) as RelationMemorySlot['slotType'];
  const key = trimString(record.key);
  const normalizedSlotType = slotType === 'boundary'
    || slotType === 'rapport'
    || slotType === 'promise'
    || slotType === 'recurringCue'
    || slotType === 'taboo'
    ? slotType
    : 'preference';
  if (!id || !targetId || !viewerId || !key) return null;
  return {
    id,
    targetId,
    viewerId,
    slotType: normalizedSlotType,
    key,
    value: trimString(record.value),
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0,
    portability: record.portability === 'portable' || record.portability === 'blocked'
      ? record.portability
      : 'local-only',
    sensitivity: record.sensitivity === 'safe' || record.sensitivity === 'intimate'
      ? record.sensitivity
      : 'personal',
    userOverride: record.userOverride === 'never-sync' || record.userOverride === 'force-portable'
      ? record.userOverride
      : 'inherit',
    updatedAt: asIsoString(record.updatedAt, nowIso()),
  };
}

export function normalizeInteractionRecallDoc(value: unknown): InteractionRecallDoc | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const id = trimString(record.id);
  const conversationId = trimString(record.conversationId);
  const text = trimString(record.text);
  if (!id || !conversationId || !text) return null;
  const createdAt = asIsoString(record.createdAt, nowIso());
  return {
    id,
    conversationId,
    sourceTurnId: trimString(record.sourceTurnId) || null,
    text,
    createdAt,
    updatedAt: asIsoString(record.updatedAt, createdAt),
  };
}

export function normalizeConversationRecord(value: unknown): LocalChatConversationRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const id = trimString(record.id);
  const targetId = trimString(record.targetId);
  const viewerId = trimString(record.viewerId);
  if (!id || !targetId || !viewerId) return null;
  const createdAt = asIsoString(record.createdAt, nowIso());
  return {
    id,
    targetId,
    viewerId,
    worldId: trimString(record.worldId) || null,
    title: trimString(record.title) || 'Session',
    createdAt,
    updatedAt: asIsoString(record.updatedAt, createdAt),
    lastTurnSeq: Number(record.lastTurnSeq) > 0 ? Math.floor(Number(record.lastTurnSeq)) : 0,
  };
}

export function normalizeTurnRecord(value: unknown): LocalChatTurnRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const id = trimString(record.id);
  const conversationId = trimString(record.conversationId);
  if (!id || !conversationId) return null;
  const createdAt = asIsoString(record.createdAt, nowIso());
  return {
    id,
    conversationId,
    seq: Number(record.seq) > 0 ? Math.floor(Number(record.seq)) : 0,
    role: record.role === 'assistant' ? 'assistant' : 'user',
    turnTxnId: trimString(record.turnTxnId) || null,
    createdAt,
    updatedAt: asIsoString(record.updatedAt, createdAt),
    beatCount: Number(record.beatCount) > 0 ? Math.floor(Number(record.beatCount)) : 0,
  };
}

export function normalizeBeatRecord(value: unknown): LocalChatStoredBeat | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  const id = trimString(record.id);
  const turnId = trimString(record.turnId);
  const conversationId = trimString(record.conversationId);
  if (!id || !turnId || !conversationId) return null;
  const timestamp = asIsoString(record.timestamp, nowIso());
  return {
    id,
    turnId,
    turnSeq: Number(record.turnSeq) > 0 ? Math.floor(Number(record.turnSeq)) : 0,
    conversationId,
    role: record.role === 'assistant' ? 'assistant' : 'user',
    beatIndex: Number(record.beatIndex) >= 0 ? Math.floor(Number(record.beatIndex)) : 0,
    beatCount: Number(record.beatCount) > 0 ? Math.floor(Number(record.beatCount)) : 1,
    kind: normalizeBeatKind(record.kind),
    deliveryStatus: normalizeDeliveryStatus(record.deliveryStatus),
    content: String(record.content || ''),
    contextText: String(record.contextText || record.content || ''),
    semanticSummary: trimString(record.semanticSummary) || null,
    mediaSpec: normalizeMediaSpec(record.mediaSpec),
    mediaShadow: normalizeMediaShadow(record.mediaShadow),
    media: normalizeBeatMedia(record.media),
    timestamp,
    latencyMs: Number.isFinite(Number(record.latencyMs)) ? Number(record.latencyMs) : undefined,
    meta: record.meta && typeof record.meta === 'object' ? asRecord(record.meta) as ChatMessageMeta : undefined,
    promptTrace: normalizeContextTrace(record.promptTrace),
    audit: normalizeTurnAudit(record.audit),
  };
}

export function cloneConversation(record: LocalChatConversationRecord): LocalChatConversationRecord {
  return {
    ...record,
  };
}

export function cloneTurnRecord(record: LocalChatTurnRecord): LocalChatTurnRecord {
  return {
    ...record,
  };
}

export function cloneStoredBeat(record: LocalChatStoredBeat): LocalChatStoredBeat {
  return {
    ...record,
    ...(record.media ? { media: { ...record.media } } : {}),
    ...(record.meta ? { meta: { ...record.meta } } : {}),
  };
}

export function cloneInteractionSnapshot(record: InteractionSnapshot): InteractionSnapshot {
  return {
    ...record,
    activeScene: [...record.activeScene],
    assistantCommitments: [...record.assistantCommitments],
    userPrefs: [...record.userPrefs],
    openLoops: [...record.openLoops],
    topicThreads: [...record.topicThreads],
  };
}

export function cloneRelationMemorySlot(record: RelationMemorySlot): RelationMemorySlot {
  return {
    ...record,
  };
}

export function cloneInteractionRecallDoc(record: InteractionRecallDoc): InteractionRecallDoc {
  return {
    ...record,
  };
}

export function cloneMediaArtifactRecord(record: LocalChatMediaArtifactRecord): LocalChatMediaArtifactRecord {
  return {
    ...record,
  };
}
