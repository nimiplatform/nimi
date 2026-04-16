import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
import type {
  AgentLocalBeatModality,
  AgentLocalBeatStatus,
  AgentLocalCancelTurnInput,
  AgentLocalCommitTurnResult,
  AgentLocalCommitTurnResultInput,
  AgentLocalCreateMessageInput,
  AgentLocalCreateThreadInput,
  AgentLocalDraftRecord,
  AgentLocalInteractionSnapshotInput,
  AgentLocalInteractionSnapshotRecord,
  AgentLocalLoadTurnContextInput,
  AgentLocalMessageError,
  AgentLocalMessageKind,
  AgentLocalMessageRecord,
  AgentLocalMessageRole,
  AgentLocalMessageStatus,
  AgentLocalPutDraftInput,
  AgentLocalProjectionCommitInput,
  AgentLocalProjectionMessageInput,
  AgentLocalProjectionRebuildResult,
  AgentLocalRecallEntryInput,
  AgentLocalRecallEntryRecord,
  AgentLocalRelationMemorySlotInput,
  AgentLocalRelationMemorySlotRecord,
  AgentLocalTargetSnapshot,
  AgentLocalTurnBeatInput,
  AgentLocalTurnBeatRecord,
  AgentLocalUpdateTurnBeatInput,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
  AgentLocalTurnContext,
  AgentLocalTurnRecord,
  AgentLocalTurnRecordInput,
  AgentLocalTurnRole,
  AgentLocalTurnStatus,
  AgentLocalUpdateMessageInput,
  AgentLocalUpdateThreadMetadataInput,
} from './chat-agent-types.js';

function parseFiniteInteger(value: unknown, fieldName: string, errorPrefix: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${errorPrefix}: ${fieldName} must be an integer`);
  }
  return numeric;
}

function parseNullableFiniteInteger(value: unknown, fieldName: string, errorPrefix: string): number | null {
  if (value == null) {
    return null;
  }
  return parseFiniteInteger(value, fieldName, errorPrefix);
}

function parseMessageRole(value: unknown, errorPrefix: string): AgentLocalMessageRole {
  const normalized = String(value || '').trim();
  if (normalized === 'system' || normalized === 'user' || normalized === 'assistant') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: role is invalid`);
}

function parseMessageStatus(value: unknown, errorPrefix: string): AgentLocalMessageStatus {
  const normalized = String(value || '').trim();
  if (normalized === 'pending' || normalized === 'complete' || normalized === 'error') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: status is invalid`);
}

function parseMessageKind(value: unknown, errorPrefix: string): AgentLocalMessageKind {
  const normalized = String(value || '').trim();
  if (normalized === 'text' || normalized === 'image' || normalized === 'voice') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: kind is invalid`);
}

function parseTurnRole(value: unknown, errorPrefix: string): AgentLocalTurnRole {
  const normalized = String(value || '').trim();
  if (normalized === 'system' || normalized === 'user' || normalized === 'assistant') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: role is invalid`);
}

function parseTurnStatus(value: unknown, errorPrefix: string): AgentLocalTurnStatus {
  const normalized = String(value || '').trim();
  if (normalized === 'pending' || normalized === 'completed' || normalized === 'failed' || normalized === 'canceled') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: status is invalid`);
}

function parseBeatModality(value: unknown, errorPrefix: string): AgentLocalBeatModality {
  const normalized = String(value || '').trim();
  if (normalized === 'text' || normalized === 'voice' || normalized === 'image' || normalized === 'video') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: modality is invalid`);
}

function parseBeatStatus(value: unknown, errorPrefix: string): AgentLocalBeatStatus {
  const normalized = String(value || '').trim();
  if (
    normalized === 'planned'
    || normalized === 'sealed'
    || normalized === 'delivered'
    || normalized === 'failed'
    || normalized === 'canceled'
  ) {
    return normalized;
  }
  throw new Error(`${errorPrefix}: status is invalid`);
}

function parseStructuredJson(
  value: unknown,
  fieldName: string,
  errorPrefix: string,
): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  throw new Error(`${errorPrefix}: ${fieldName} must be an array or object`);
}

function parseOwnershipType(
  value: unknown,
  errorPrefix: string,
): AgentLocalTargetSnapshot['ownershipType'] {
  const normalized = parseOptionalString(value) || null;
  if (!normalized) {
    return null;
  }
  if (normalized === 'MASTER_OWNED' || normalized === 'WORLD_OWNED') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: ownershipType is invalid`);
}

function parseAvatarBackendKind(
  value: unknown,
  errorPrefix: string,
): AvatarPresentationProfile['backendKind'] {
  const normalized = parseRequiredString(value, 'backendKind', errorPrefix);
  if (normalized === 'vrm' || normalized === 'sprite2d' || normalized === 'canvas2d' || normalized === 'video') {
    return normalized;
  }
  throw new Error(`${errorPrefix}: backendKind is invalid`);
}

function parseAvatarPresentationProfile(value: unknown, errorPrefix: string): AvatarPresentationProfile | null {
  if (value == null) {
    return null;
  }
  const record = assertRecord(value, `${errorPrefix}: presentationProfile is invalid`);
  return {
    backendKind: parseAvatarBackendKind(record.backendKind, errorPrefix),
    avatarAssetRef: parseRequiredString(record.avatarAssetRef, 'avatarAssetRef', errorPrefix),
    expressionProfileRef: parseOptionalString(record.expressionProfileRef) || null,
    idlePreset: parseOptionalString(record.idlePreset) || null,
    interactionPolicyRef: parseOptionalString(record.interactionPolicyRef) || null,
    defaultVoiceReference: parseOptionalString(record.defaultVoiceReference) || null,
  };
}

export function parseAgentLocalTargetSnapshot(value: unknown): AgentLocalTargetSnapshot {
  const record = assertRecord(value, 'chat_agent target snapshot is invalid');
  return {
    agentId: parseRequiredString(record.agentId, 'agentId', 'chat_agent target snapshot'),
    displayName: parseRequiredString(record.displayName, 'displayName', 'chat_agent target snapshot'),
    handle: parseRequiredString(record.handle, 'handle', 'chat_agent target snapshot'),
    avatarUrl: parseOptionalString(record.avatarUrl) || null,
    presentationProfile: parseAvatarPresentationProfile(record.presentationProfile, 'chat_agent target snapshot'),
    worldId: parseOptionalString(record.worldId) || null,
    worldName: parseOptionalString(record.worldName) || null,
    bio: parseOptionalString(record.bio) || null,
    ownershipType: parseOwnershipType(record.ownershipType, 'chat_agent target snapshot'),
  };
}

export function parseAgentLocalThreadSummary(value: unknown): AgentLocalThreadSummary {
  const record = assertRecord(value, 'chat_agent thread summary is invalid');
  const agentId = parseRequiredString(record.agentId, 'agentId', 'chat_agent thread summary');
  const targetSnapshot = parseAgentLocalTargetSnapshot(record.targetSnapshot);
  if (targetSnapshot.agentId !== agentId) {
    throw new Error('chat_agent thread summary: targetSnapshot.agentId must match agentId');
  }
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent thread summary'),
    agentId,
    title: parseRequiredString(record.title, 'title', 'chat_agent thread summary'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent thread summary'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_agent thread summary'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_agent thread summary'),
    targetSnapshot,
  };
}

export function parseAgentLocalThreadSummaries(value: unknown): AgentLocalThreadSummary[] {
  if (!Array.isArray(value)) {
    throw new Error('chat_agent list_threads returned non-array payload');
  }
  return value.map((item) => parseAgentLocalThreadSummary(item));
}

export function parseAgentLocalThreadRecord(value: unknown): AgentLocalThreadRecord {
  const record = assertRecord(value, 'chat_agent thread record is invalid');
  return {
    ...parseAgentLocalThreadSummary(record),
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent thread record'),
  };
}

export function parseAgentLocalMessageError(value: unknown): AgentLocalMessageError {
  const record = assertRecord(value, 'chat_agent message error is invalid');
  return {
    code: parseOptionalString(record.code),
    message: parseRequiredString(record.message, 'message', 'chat_agent message error'),
  };
}

export function parseAgentLocalMessageRecord(value: unknown): AgentLocalMessageRecord {
  const record = assertRecord(value, 'chat_agent message record is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent message record'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent message record'),
    role: parseMessageRole(record.role, 'chat_agent message record'),
    status: parseMessageStatus(record.status, 'chat_agent message record'),
    kind: parseMessageKind(record.kind, 'chat_agent message record'),
    contentText: String(record.contentText ?? ''),
    reasoningText: parseOptionalString(record.reasoningText) || null,
    error: record.error == null ? null : parseAgentLocalMessageError(record.error),
    traceId: parseOptionalString(record.traceId) || null,
    parentMessageId: parseOptionalString(record.parentMessageId) || null,
    mediaUrl: parseOptionalString(record.mediaUrl) || null,
    mediaMimeType: parseOptionalString(record.mediaMimeType) || null,
    artifactId: parseOptionalString(record.artifactId) || null,
    metadataJson: parseOptionalJsonObject(record.metadataJson) || null,
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent message record'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent message record'),
  };
}

export function parseAgentLocalDraftRecord(value: unknown): AgentLocalDraftRecord {
  const record = assertRecord(value, 'chat_agent draft record is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent draft record'),
    text: String(record.text ?? ''),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent draft record'),
  };
}

export function parseAgentLocalTurnRecord(value: unknown): AgentLocalTurnRecord {
  const record = assertRecord(value, 'chat_agent turn record is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent turn record'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent turn record'),
    role: parseTurnRole(record.role, 'chat_agent turn record'),
    status: parseTurnStatus(record.status, 'chat_agent turn record'),
    providerMode: parseRequiredString(record.providerMode, 'providerMode', 'chat_agent turn record'),
    traceId: parseOptionalString(record.traceId) || null,
    promptTraceId: parseOptionalString(record.promptTraceId) || null,
    startedAtMs: parseFiniteInteger(record.startedAtMs, 'startedAtMs', 'chat_agent turn record'),
    completedAtMs: parseNullableFiniteInteger(record.completedAtMs, 'completedAtMs', 'chat_agent turn record'),
    abortedAtMs: parseNullableFiniteInteger(record.abortedAtMs, 'abortedAtMs', 'chat_agent turn record'),
  };
}

export function parseAgentLocalTurnBeatRecord(value: unknown): AgentLocalTurnBeatRecord {
  const record = assertRecord(value, 'chat_agent turn beat record is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent turn beat record'),
    turnId: parseRequiredString(record.turnId, 'turnId', 'chat_agent turn beat record'),
    beatIndex: parseFiniteInteger(record.beatIndex, 'beatIndex', 'chat_agent turn beat record'),
    modality: parseBeatModality(record.modality, 'chat_agent turn beat record'),
    status: parseBeatStatus(record.status, 'chat_agent turn beat record'),
    textShadow: parseOptionalString(record.textShadow) || null,
    artifactId: parseOptionalString(record.artifactId) || null,
    mimeType: parseOptionalString(record.mimeType) || null,
    mediaUrl: parseOptionalString(record.mediaUrl) || null,
    projectionMessageId: parseOptionalString(record.projectionMessageId) || null,
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent turn beat record'),
    deliveredAtMs: parseNullableFiniteInteger(record.deliveredAtMs, 'deliveredAtMs', 'chat_agent turn beat record'),
  };
}

export function parseAgentLocalUpdateTurnBeatInput(value: unknown): AgentLocalUpdateTurnBeatInput {
  const record = assertRecord(value, 'chat_agent update turn beat input is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent update turn beat input'),
    status: parseBeatStatus(record.status, 'chat_agent update turn beat input'),
    textShadow: parseOptionalString(record.textShadow) || null,
    artifactId: parseOptionalString(record.artifactId) || null,
    mimeType: parseOptionalString(record.mimeType) || null,
    mediaUrl: parseOptionalString(record.mediaUrl) || null,
    deliveredAtMs: parseNullableFiniteInteger(record.deliveredAtMs, 'deliveredAtMs', 'chat_agent update turn beat input'),
  };
}

export function parseAgentLocalInteractionSnapshotRecord(value: unknown): AgentLocalInteractionSnapshotRecord {
  const record = assertRecord(value, 'chat_agent interaction snapshot record is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent interaction snapshot record'),
    version: parseFiniteInteger(record.version, 'version', 'chat_agent interaction snapshot record'),
    relationshipState: parseRequiredString(record.relationshipState, 'relationshipState', 'chat_agent interaction snapshot record'),
    emotionalTemperature: Number(record.emotionalTemperature),
    assistantCommitmentsJson: parseStructuredJson(record.assistantCommitmentsJson, 'assistantCommitmentsJson', 'chat_agent interaction snapshot record'),
    userPrefsJson: parseStructuredJson(record.userPrefsJson, 'userPrefsJson', 'chat_agent interaction snapshot record'),
    openLoopsJson: parseStructuredJson(record.openLoopsJson, 'openLoopsJson', 'chat_agent interaction snapshot record'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent interaction snapshot record'),
  };
}

export function parseAgentLocalRelationMemorySlotRecord(value: unknown): AgentLocalRelationMemorySlotRecord {
  const record = assertRecord(value, 'chat_agent relation memory slot record is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent relation memory slot record'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent relation memory slot record'),
    slotType: parseRequiredString(record.slotType, 'slotType', 'chat_agent relation memory slot record'),
    summary: parseRequiredString(record.summary, 'summary', 'chat_agent relation memory slot record'),
    sourceTurnId: parseOptionalString(record.sourceTurnId) || null,
    sourceBeatId: parseOptionalString(record.sourceBeatId) || null,
    sourceMessageId: parseOptionalString(record.sourceMessageId) || null,
    score: Number(record.score),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent relation memory slot record'),
  };
}

export function parseAgentLocalRecallEntryRecord(value: unknown): AgentLocalRecallEntryRecord {
  const record = assertRecord(value, 'chat_agent recall entry record is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent recall entry record'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent recall entry record'),
    sourceTurnId: parseOptionalString(record.sourceTurnId) || null,
    sourceBeatId: parseOptionalString(record.sourceBeatId) || null,
    sourceMessageId: parseOptionalString(record.sourceMessageId) || null,
    summary: parseRequiredString(record.summary, 'summary', 'chat_agent recall entry record'),
    searchText: parseRequiredString(record.searchText, 'searchText', 'chat_agent recall entry record'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent recall entry record'),
  };
}

export function parseAgentLocalThreadBundle(value: unknown): AgentLocalThreadBundle | null {
  if (value == null) {
    return null;
  }
  const record = assertRecord(value, 'chat_agent thread bundle is invalid');
  return {
    thread: parseAgentLocalThreadRecord(record.thread),
    messages: Array.isArray(record.messages)
      ? record.messages.map((item) => parseAgentLocalMessageRecord(item))
      : (() => { throw new Error('chat_agent thread bundle.messages must be an array'); })(),
    draft: record.draft == null ? null : parseAgentLocalDraftRecord(record.draft),
  };
}

export function parseAgentLocalTurnContext(value: unknown): AgentLocalTurnContext {
  const record = assertRecord(value, 'chat_agent turn context is invalid');
  return {
    thread: parseAgentLocalThreadRecord(record.thread),
    recentTurns: Array.isArray(record.recentTurns)
      ? record.recentTurns.map((item) => parseAgentLocalTurnRecord(item))
      : (() => { throw new Error('chat_agent turn context.recentTurns must be an array'); })(),
    recentBeats: Array.isArray(record.recentBeats)
      ? record.recentBeats.map((item) => parseAgentLocalTurnBeatRecord(item))
      : (() => { throw new Error('chat_agent turn context.recentBeats must be an array'); })(),
    interactionSnapshot: record.interactionSnapshot == null
      ? null
      : parseAgentLocalInteractionSnapshotRecord(record.interactionSnapshot),
    relationMemorySlots: Array.isArray(record.relationMemorySlots)
      ? record.relationMemorySlots.map((item) => parseAgentLocalRelationMemorySlotRecord(item))
      : (() => { throw new Error('chat_agent turn context.relationMemorySlots must be an array'); })(),
    recallEntries: Array.isArray(record.recallEntries)
      ? record.recallEntries.map((item) => parseAgentLocalRecallEntryRecord(item))
      : (() => { throw new Error('chat_agent turn context.recallEntries must be an array'); })(),
    draft: record.draft == null ? null : parseAgentLocalDraftRecord(record.draft),
    projectionVersion: parseRequiredString(record.projectionVersion, 'projectionVersion', 'chat_agent turn context'),
  };
}

export function parseAgentLocalProjectionRebuildResult(value: unknown): AgentLocalProjectionRebuildResult {
  const record = assertRecord(value, 'chat_agent projection rebuild result is invalid');
  return {
    bundle: parseAgentLocalThreadBundle(record.bundle) ?? (() => { throw new Error('chat_agent projection rebuild result.bundle is invalid'); })(),
    projectionVersion: parseRequiredString(record.projectionVersion, 'projectionVersion', 'chat_agent projection rebuild result'),
  };
}

export function parseAgentLocalCommitTurnResult(value: unknown): AgentLocalCommitTurnResult {
  const record = assertRecord(value, 'chat_agent commit turn result is invalid');
  return {
    turn: parseAgentLocalTurnRecord(record.turn),
    beats: Array.isArray(record.beats)
      ? record.beats.map((item) => parseAgentLocalTurnBeatRecord(item))
      : (() => { throw new Error('chat_agent commit turn result.beats must be an array'); })(),
    interactionSnapshot: record.interactionSnapshot == null
      ? null
      : parseAgentLocalInteractionSnapshotRecord(record.interactionSnapshot),
    relationMemorySlots: Array.isArray(record.relationMemorySlots)
      ? record.relationMemorySlots.map((item) => parseAgentLocalRelationMemorySlotRecord(item))
      : (() => { throw new Error('chat_agent commit turn result.relationMemorySlots must be an array'); })(),
    recallEntries: Array.isArray(record.recallEntries)
      ? record.recallEntries.map((item) => parseAgentLocalRecallEntryRecord(item))
      : (() => { throw new Error('chat_agent commit turn result.recallEntries must be an array'); })(),
    bundle: parseAgentLocalThreadBundle(record.bundle) ?? (() => { throw new Error('chat_agent commit turn result.bundle is invalid'); })(),
    projectionVersion: parseRequiredString(record.projectionVersion, 'projectionVersion', 'chat_agent commit turn result'),
  };
}

export function parseAgentLocalCreateThreadInput(value: unknown): AgentLocalCreateThreadInput {
  const record = assertRecord(value, 'chat_agent create_thread payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent create_thread payload'),
    agentId: parseRequiredString(record.agentId, 'agentId', 'chat_agent create_thread payload'),
    title: parseRequiredString(record.title, 'title', 'chat_agent create_thread payload'),
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent create_thread payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent create_thread payload'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_agent create_thread payload'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_agent create_thread payload'),
    targetSnapshot: parseAgentLocalTargetSnapshot(record.targetSnapshot),
  };
}

export function parseAgentLocalUpdateThreadMetadataInput(value: unknown): AgentLocalUpdateThreadMetadataInput {
  const record = assertRecord(value, 'chat_agent update_thread_metadata payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent update_thread_metadata payload'),
    title: parseRequiredString(record.title, 'title', 'chat_agent update_thread_metadata payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent update_thread_metadata payload'),
    lastMessageAtMs: parseNullableFiniteInteger(record.lastMessageAtMs, 'lastMessageAtMs', 'chat_agent update_thread_metadata payload'),
    archivedAtMs: parseNullableFiniteInteger(record.archivedAtMs, 'archivedAtMs', 'chat_agent update_thread_metadata payload'),
    targetSnapshot: parseAgentLocalTargetSnapshot(record.targetSnapshot),
  };
}

export function parseAgentLocalCreateMessageInput(value: unknown): AgentLocalCreateMessageInput {
  const record = assertRecord(value, 'chat_agent create_message payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent create_message payload'),
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent create_message payload'),
    role: parseMessageRole(record.role, 'chat_agent create_message payload'),
    status: parseMessageStatus(record.status, 'chat_agent create_message payload'),
    kind: parseMessageKind(record.kind, 'chat_agent create_message payload'),
    contentText: String(record.contentText ?? ''),
    reasoningText: parseOptionalString(record.reasoningText) || null,
    error: record.error == null ? null : parseAgentLocalMessageError(record.error),
    traceId: parseOptionalString(record.traceId) || null,
    parentMessageId: parseOptionalString(record.parentMessageId) || null,
    mediaUrl: parseOptionalString(record.mediaUrl) || null,
    mediaMimeType: parseOptionalString(record.mediaMimeType) || null,
    artifactId: parseOptionalString(record.artifactId) || null,
    metadataJson: parseOptionalJsonObject(record.metadataJson) || null,
    createdAtMs: parseFiniteInteger(record.createdAtMs, 'createdAtMs', 'chat_agent create_message payload'),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent create_message payload'),
  };
}

export function parseAgentLocalUpdateMessageInput(value: unknown): AgentLocalUpdateMessageInput {
  const record = assertRecord(value, 'chat_agent update_message payload is invalid');
  return {
    id: parseRequiredString(record.id, 'id', 'chat_agent update_message payload'),
    kind: parseMessageKind(record.kind, 'chat_agent update_message payload'),
    status: parseMessageStatus(record.status, 'chat_agent update_message payload'),
    contentText: String(record.contentText ?? ''),
    reasoningText: parseOptionalString(record.reasoningText) || null,
    error: record.error == null ? null : parseAgentLocalMessageError(record.error),
    traceId: parseOptionalString(record.traceId) || null,
    mediaUrl: parseOptionalString(record.mediaUrl) || null,
    mediaMimeType: parseOptionalString(record.mediaMimeType) || null,
    artifactId: parseOptionalString(record.artifactId) || null,
    metadataJson: parseOptionalJsonObject(record.metadataJson) || null,
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent update_message payload'),
  };
}

export function parseAgentLocalPutDraftInput(value: unknown): AgentLocalPutDraftInput {
  const record = assertRecord(value, 'chat_agent put_draft payload is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent put_draft payload'),
    text: String(record.text ?? ''),
    updatedAtMs: parseFiniteInteger(record.updatedAtMs, 'updatedAtMs', 'chat_agent put_draft payload'),
  };
}

export function parseAgentLocalLoadTurnContextInput(value: unknown): AgentLocalLoadTurnContextInput {
  const record = assertRecord(value, 'chat_agent load_turn_context payload is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent load_turn_context payload'),
    recentTurnLimit: record.recentTurnLimit == null ? undefined : parseFiniteInteger(record.recentTurnLimit, 'recentTurnLimit', 'chat_agent load_turn_context payload'),
    relationMemoryLimit: record.relationMemoryLimit == null ? undefined : parseFiniteInteger(record.relationMemoryLimit, 'relationMemoryLimit', 'chat_agent load_turn_context payload'),
    recallLimit: record.recallLimit == null ? undefined : parseFiniteInteger(record.recallLimit, 'recallLimit', 'chat_agent load_turn_context payload'),
  };
}

export function parseAgentLocalTurnRecordInput(value: unknown): AgentLocalTurnRecordInput {
  return parseAgentLocalTurnRecord(value);
}

export function parseAgentLocalTurnBeatInput(value: unknown): AgentLocalTurnBeatInput {
  return parseAgentLocalTurnBeatRecord(value);
}

export function parseAgentLocalInteractionSnapshotInput(value: unknown): AgentLocalInteractionSnapshotInput {
  return parseAgentLocalInteractionSnapshotRecord(value);
}

export function parseAgentLocalRelationMemorySlotInput(value: unknown): AgentLocalRelationMemorySlotInput {
  return parseAgentLocalRelationMemorySlotRecord(value);
}

export function parseAgentLocalRecallEntryInput(value: unknown): AgentLocalRecallEntryInput {
  return parseAgentLocalRecallEntryRecord(value);
}

export function parseAgentLocalProjectionMessageInput(value: unknown): AgentLocalProjectionMessageInput {
  return parseAgentLocalMessageRecord(value);
}

export function parseAgentLocalProjectionCommitInput(value: unknown): AgentLocalProjectionCommitInput {
  const record = assertRecord(value, 'chat_agent projection payload is invalid');
  return {
    thread: parseAgentLocalUpdateThreadMetadataInput(record.thread),
    messages: Array.isArray(record.messages)
      ? record.messages.map((item) => parseAgentLocalProjectionMessageInput(item))
      : (() => { throw new Error('chat_agent projection payload.messages must be an array'); })(),
    draft: record.draft == null ? null : parseAgentLocalPutDraftInput(record.draft),
    clearDraft: Boolean(record.clearDraft),
  };
}

export function parseAgentLocalCommitTurnResultInput(value: unknown): AgentLocalCommitTurnResultInput {
  const record = assertRecord(value, 'chat_agent commit_turn_result payload is invalid');
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent commit_turn_result payload'),
    turn: parseAgentLocalTurnRecordInput(record.turn),
    beats: Array.isArray(record.beats)
      ? record.beats.map((item) => parseAgentLocalTurnBeatInput(item))
      : (() => { throw new Error('chat_agent commit_turn_result payload.beats must be an array'); })(),
    interactionSnapshot: record.interactionSnapshot == null
      ? null
      : parseAgentLocalInteractionSnapshotInput(record.interactionSnapshot),
    relationMemorySlots: Array.isArray(record.relationMemorySlots)
      ? record.relationMemorySlots.map((item) => parseAgentLocalRelationMemorySlotInput(item))
      : (() => { throw new Error('chat_agent commit_turn_result payload.relationMemorySlots must be an array'); })(),
    recallEntries: Array.isArray(record.recallEntries)
      ? record.recallEntries.map((item) => parseAgentLocalRecallEntryInput(item))
      : (() => { throw new Error('chat_agent commit_turn_result payload.recallEntries must be an array'); })(),
    projection: parseAgentLocalProjectionCommitInput(record.projection),
  };
}

export function parseAgentLocalCancelTurnInput(value: unknown): AgentLocalCancelTurnInput {
  const record = assertRecord(value, 'chat_agent cancel_turn payload is invalid');
  const scope = parseRequiredString(record.scope, 'scope', 'chat_agent cancel_turn payload');
  if (scope !== 'turn' && scope !== 'tail' && scope !== 'projection') {
    throw new Error('chat_agent cancel_turn payload: scope is invalid');
  }
  return {
    threadId: parseRequiredString(record.threadId, 'threadId', 'chat_agent cancel_turn payload'),
    turnId: parseRequiredString(record.turnId, 'turnId', 'chat_agent cancel_turn payload'),
    scope,
    abortedAtMs: parseFiniteInteger(record.abortedAtMs, 'abortedAtMs', 'chat_agent cancel_turn payload'),
  };
}
