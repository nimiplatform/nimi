import type {
  ConversationMessageViewModel,
} from '@nimiplatform/kit/features/chat/headless';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalString,
  parseRequiredString,
} from '@renderer/bridge/runtime-bridge/shared';
import {
  projectRealmAgentBuiltinDocsContext,
  projectRealmAgentGreeting,
} from './agent-profile-projection.js';

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildLocalAgentRef(ownerUserId: string, realmAgentId: string): string {
  return `local-agent:${ownerUserId}:${realmAgentId}`;
}

function parseOwnerUserId(snapshot: { ownerUserId?: unknown; currentUserId?: unknown; userId?: unknown; viewerId?: unknown }): string {
  return normalizeText(snapshot.ownerUserId)
    || normalizeText(snapshot.currentUserId)
    || normalizeText(snapshot.userId)
    || normalizeText(snapshot.viewerId);
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
  return null;
}

export function mergeAgentTargetWithPresentationProfile(
  target: AgentLocalTargetSnapshot | null,
  presentationProfile: AvatarPresentationProfile | null | undefined,
): AgentLocalTargetSnapshot | null {
  if (!target) {
    return null;
  }
  const nextPresentationProfile = presentationProfile || target.presentationProfile || null;
  const nextAvatarUrl = target.avatarUrl || null;
  if (nextPresentationProfile === (target.presentationProfile || null) && nextAvatarUrl === (target.avatarUrl || null)) {
    return target;
  }
  return {
    ...target,
    avatarUrl: nextAvatarUrl,
    presentationProfile: nextPresentationProfile,
  };
}

/**
 * Overlay the live Realm/SDK projected RealmAgent profile content onto a
 * persisted thread target.
 *
 * A persisted thread `targetSnapshot` carries durable identity but does not
 * round-trip live RealmAgent profile content (`presentationProfile`,
 * `greeting`, `builtinDocsContext`). The live projected target — refreshed
 * from the Realm/SDK agent projection — is the source of truth for that
 * content at chat time. This overlays it generically for any RealmAgent.
 */
export function overlayAgentTargetWithLiveProfileContent(
  threadTarget: AgentLocalTargetSnapshot | null,
  liveTarget: AgentLocalTargetSnapshot | null | undefined,
): AgentLocalTargetSnapshot | null {
  if (!threadTarget) {
    return null;
  }
  if (!liveTarget || liveTarget.localAgentRef !== threadTarget.localAgentRef) {
    return threadTarget;
  }
  const merged = mergeAgentTargetWithPresentationProfile(
    threadTarget,
    liveTarget.presentationProfile || null,
  ) as AgentLocalTargetSnapshot;
  const nextGreeting = liveTarget.greeting ?? threadTarget.greeting ?? null;
  const nextDocs = liveTarget.builtinDocsContext ?? threadTarget.builtinDocsContext ?? null;
  if (
    nextGreeting === (threadTarget.greeting ?? null)
    && nextDocs === (threadTarget.builtinDocsContext ?? null)
    && merged === threadTarget
  ) {
    return threadTarget;
  }
  return {
    ...merged,
    greeting: nextGreeting,
    builtinDocsContext: nextDocs,
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
  return left.ownerUserId === right.ownerUserId
    && left.realmAgentId === right.realmAgentId
    && left.localAgentRef === right.localAgentRef
    && left.displayName === right.displayName
    && left.handle === right.handle
    && (left.avatarUrl || null) === (right.avatarUrl || null)
    && (left.worldId || null) === (right.worldId || null)
    && (left.worldName || null) === (right.worldName || null)
    && (left.bio || null) === (right.bio || null)
    && (left.ownershipType || null) === (right.ownershipType || null)
    && arePresentationProfilesEqual(left.presentationProfile, right.presentationProfile);
}

function parseAgentFriendTarget(value: unknown, ownerUserId: string): AgentLocalTargetSnapshot {
  const record = assertRecord(value, 'agent friend target is invalid');
  if (record.isAgent !== true) {
    throw new Error('agent friend target must set isAgent=true');
  }
  const world = parseOptionalJsonObject(record.world) ?? null;
  const agentProfile = parseOptionalJsonObject(record.agentProfile) ?? null;
  const avatarUrl = parseOptionalString(record.avatarUrl) || parseOptionalString(agentProfile?.avatarUrl) || null;
  const realmAgentId = parseRequiredString(record.id, 'id', 'agent friend target');
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef: buildLocalAgentRef(ownerUserId, realmAgentId),
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
    // Ordinary RealmAgent profile content projected from the Realm agent
    // projection — applies to any RealmAgent, no guide-specific branch.
    greeting: projectRealmAgentGreeting(agentProfile),
    builtinDocsContext: projectRealmAgentBuiltinDocsContext(agentProfile),
  };
}

export function toAgentFriendTargetsFromSocialSnapshot(
  snapshot: { friends?: unknown[]; ownerUserId?: unknown; currentUserId?: unknown; userId?: unknown; viewerId?: unknown } | null | undefined,
): AgentLocalTargetSnapshot[] {
  const ownerUserId = parseOwnerUserId(snapshot || {});
  if (!ownerUserId) {
    throw new Error('agent friend targets require ownerUserId');
  }
  const friends = Array.isArray(snapshot?.friends) ? snapshot.friends : [];
  return friends
    .filter((item) => (parseOptionalJsonObject(item)?.isAgent === true))
    .map((item) => parseAgentFriendTarget(item, ownerUserId))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
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
