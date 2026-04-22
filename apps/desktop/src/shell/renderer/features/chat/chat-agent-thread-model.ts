import type {
  ConversationMessageViewModel,
  ConversationThreadSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  resolveSpriteAvatarImageUrl,
  type AvatarPresentationProfile,
} from '@nimiplatform/nimi-kit/features/avatar/headless';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
  AgentLocalUpdateThreadMetadataInput,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalString,
  parseRequiredString,
} from '@renderer/bridge/runtime-bridge/shared';

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseOwnershipType(value: unknown): AgentLocalTargetSnapshot['ownershipType'] {
  const normalized = String(value || '').trim();
  if (normalized === 'MASTER_OWNED' || normalized === 'WORLD_OWNED') {
    return normalized;
  }
  return null;
}

function parseAvatarBackendKind(value: unknown): AvatarPresentationProfile['backendKind'] | null {
  const normalized = parseOptionalString(value);
  if (
    normalized === 'vrm'
    || normalized === 'live2d'
    || normalized === 'sprite2d'
    || normalized === 'canvas2d'
    || normalized === 'video'
  ) {
    return normalized;
  }
  return null;
}

function parsePresentationProfile(value: unknown): AvatarPresentationProfile | null {
  const record = parseOptionalJsonObject(value);
  const backendKind = parseAvatarBackendKind(record?.backendKind);
  const avatarAssetRef = parseOptionalString(record?.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    return null;
  }
  return {
    backendKind,
    avatarAssetRef,
    expressionProfileRef: parseOptionalString(record?.expressionProfileRef) || null,
    idlePreset: parseOptionalString(record?.idlePreset) || null,
    interactionPolicyRef: parseOptionalString(record?.interactionPolicyRef) || null,
    defaultVoiceReference: parseOptionalString(record?.defaultVoiceReference) || null,
  };
}

function resolveTargetPresentationProfile(input: {
  record: Record<string, unknown>;
  agentProfile: Record<string, unknown> | null;
  avatarUrl: string | null;
}): AvatarPresentationProfile | null {
  const explicitPresentation = parsePresentationProfile(input.record.presentationProfile)
    || parsePresentationProfile(input.agentProfile?.presentationProfile);
  if (explicitPresentation) {
    return explicitPresentation;
  }
  if (!input.avatarUrl) {
    return null;
  }
  return {
    backendKind: 'sprite2d',
    avatarAssetRef: input.avatarUrl,
    expressionProfileRef: null,
    idlePreset: null,
    interactionPolicyRef: null,
    defaultVoiceReference: null,
  };
}

export function mergeAgentTargetWithPresentationProfile(
  target: AgentLocalTargetSnapshot | null,
  presentationProfile: AvatarPresentationProfile | null | undefined,
): AgentLocalTargetSnapshot | null {
  if (!target) {
    return null;
  }
  const nextPresentationProfile = presentationProfile || target.presentationProfile || null;
  const nextAvatarUrl = resolveSpriteAvatarImageUrl(nextPresentationProfile, target.avatarUrl || null);
  if (nextPresentationProfile === (target.presentationProfile || null) && nextAvatarUrl === (target.avatarUrl || null)) {
    return target;
  }
  return {
    ...target,
    avatarUrl: nextAvatarUrl,
    presentationProfile: nextPresentationProfile,
  };
}

function arePresentationProfilesEqual(
  left: AvatarPresentationProfile | null | undefined,
  right: AvatarPresentationProfile | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.backendKind === right.backendKind
    && left.avatarAssetRef === right.avatarAssetRef
    && (left.expressionProfileRef || null) === (right.expressionProfileRef || null)
    && (left.idlePreset || null) === (right.idlePreset || null)
    && (left.interactionPolicyRef || null) === (right.interactionPolicyRef || null)
    && (left.defaultVoiceReference || null) === (right.defaultVoiceReference || null);
}

export function areAgentTargetSnapshotsEquivalent(
  left: AgentLocalTargetSnapshot | null | undefined,
  right: AgentLocalTargetSnapshot | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.agentId === right.agentId
    && left.displayName === right.displayName
    && left.handle === right.handle
    && (left.avatarUrl || null) === (right.avatarUrl || null)
    && (left.worldId || null) === (right.worldId || null)
    && (left.worldName || null) === (right.worldName || null)
    && (left.bio || null) === (right.bio || null)
    && (left.ownershipType || null) === (right.ownershipType || null)
    && arePresentationProfilesEqual(left.presentationProfile, right.presentationProfile);
}

export function buildAgentThreadMetadataUpdate(input: {
  thread: AgentLocalThreadSummary | null;
  target: AgentLocalTargetSnapshot | null;
}): AgentLocalUpdateThreadMetadataInput | null {
  if (!input.thread || !input.target || input.thread.agentId !== input.target.agentId) {
    return null;
  }
  if (areAgentTargetSnapshotsEquivalent(input.thread.targetSnapshot, input.target)) {
    return null;
  }
  return {
    id: input.thread.id,
    title: input.thread.title,
    updatedAtMs: input.thread.updatedAtMs,
    lastMessageAtMs: input.thread.lastMessageAtMs,
    archivedAtMs: input.thread.archivedAtMs,
    targetSnapshot: input.target,
  };
}

function parseAgentFriendTarget(value: unknown): AgentLocalTargetSnapshot {
  const record = assertRecord(value, 'agent friend target is invalid');
  if (record.isAgent !== true) {
    throw new Error('agent friend target must set isAgent=true');
  }
  const world = parseOptionalJsonObject(record.world) ?? null;
  const agentProfile = parseOptionalJsonObject(record.agentProfile) ?? null;
  const avatarUrl = parseOptionalString(record.avatarUrl) || parseOptionalString(agentProfile?.avatarUrl) || null;
  return {
    agentId: parseRequiredString(record.id, 'id', 'agent friend target'),
    displayName: parseRequiredString(record.displayName, 'displayName', 'agent friend target'),
    handle: parseRequiredString(record.handle, 'handle', 'agent friend target'),
    avatarUrl,
    presentationProfile: resolveTargetPresentationProfile({
      record,
      agentProfile,
      avatarUrl,
    }),
    worldId: parseOptionalString(record.worldId)
      || parseOptionalString(world?.id)
      || null,
    worldName: parseOptionalString(record.worldName)
      || parseOptionalString(world?.name)
      || null,
    bio: parseOptionalString(record.bio) || null,
    ownershipType: parseOwnershipType(record.ownershipType || agentProfile?.ownershipType),
  };
}

export function toAgentFriendTargetsFromSocialSnapshot(
  snapshot: { friends?: unknown[] } | null | undefined,
): AgentLocalTargetSnapshot[] {
  const friends = Array.isArray(snapshot?.friends) ? snapshot.friends : [];
  return friends
    .filter((item) => (parseOptionalJsonObject(item)?.isAgent === true))
    .map((item) => parseAgentFriendTarget(item))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function findAgentConversationThreadByAgentId(
  threads: readonly AgentLocalThreadSummary[],
  agentId: string | null | undefined,
): AgentLocalThreadSummary | null {
  const normalizedAgentId = normalizeText(agentId);
  if (!normalizedAgentId) {
    return null;
  }
  return threads.find((thread) => thread.agentId === normalizedAgentId) || null;
}

export function resolveAgentConversationActiveThreadId(input: {
  threads: readonly AgentLocalThreadSummary[];
  selectionThreadId: string | null | undefined;
  selectionAgentId: string | null | undefined;
  lastSelectedThreadId: string | null | undefined;
}): string | null {
  const normalizedSelectionThreadId = normalizeText(input.selectionThreadId);
  if (normalizedSelectionThreadId && input.threads.some((thread) => thread.id === normalizedSelectionThreadId)) {
    return normalizedSelectionThreadId;
  }
  const normalizedLastSelectedThreadId = normalizeText(input.lastSelectedThreadId);
  if (normalizedLastSelectedThreadId && input.threads.some((thread) => thread.id === normalizedLastSelectedThreadId)) {
    return normalizedLastSelectedThreadId;
  }
  return null;
}

export function toConversationThreadSummary(
  thread: AgentLocalThreadSummary,
): ConversationThreadSummary {
  return {
    id: thread.id,
    mode: 'agent',
    title: thread.title,
    previewText: '',
    createdAt: toIsoString(thread.updatedAtMs),
    updatedAt: toIsoString(thread.updatedAtMs),
    unreadCount: 0,
    status: thread.archivedAtMs == null ? 'active' : 'archived',
    pinned: false,
    targetId: thread.agentId,
    targetLabel: thread.targetSnapshot.displayName,
  };
}

export function toConversationMessageViewModel(
  message: AgentLocalMessageRecord,
): ConversationMessageViewModel {
  const transcriptText = parseOptionalString(message.metadataJson?.transcriptText) || message.contentText;
  const metadata = {
    ...(message.metadataJson || {}),
    kind: message.kind,
    traceId: message.traceId,
    parentMessageId: message.parentMessageId,
    reasoningText: message.reasoningText,
    mediaUrl: message.mediaUrl,
    voiceUrl: message.mediaUrl,
    mediaMimeType: message.mediaMimeType,
    artifactId: message.artifactId,
    voiceTranscript: transcriptText,
    mediaError: message.error?.message || null,
  };
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    text: message.contentText,
    createdAt: toIsoString(message.createdAtMs),
    updatedAt: toIsoString(message.updatedAtMs),
    status: message.status,
    error: message.error?.message || null,
    metadata,
  };
}

export function getAgentTargetDisplaySummary(target: AgentLocalTargetSnapshot): string {
  const ownership = target.ownershipType === 'MASTER_OWNED'
    ? 'My agent'
    : target.ownershipType === 'WORLD_OWNED'
      ? 'World agent'
      : null;
  return [target.worldName, ownership].filter(Boolean).join(' · ') || target.handle;
}
