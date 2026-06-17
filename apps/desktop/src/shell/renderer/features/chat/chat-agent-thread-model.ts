import type {
  ConversationMessageViewModel,
} from '@nimiplatform/kit/features/chat/headless';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
} from '@renderer/bridge/runtime-bridge/types';
import { buildRuntimeLocalAgentRef } from '@nimiplatform/sdk/runtime';
import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from '@nimiplatform/kit/shell/renderer/bridge';
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
  const worldId = parseOptionalString(input.record.worldId)
    || parseOptionalString(parseOptionalJsonObject(input.record.world)?.id)
    || parseOptionalString(input.agentProfile?.worldId)
    || '';
  const ownershipType = parseOwnershipType(input.record.ownershipType || input.agentProfile?.ownershipType);
  if (
    input.avatarUrl
    && ownershipType === 'WORLD_OWNED'
    && worldId.startsWith('cbdb-')
  ) {
    return {
      backendKind: 'sprite2d',
      avatarAssetRef: `profile_media_url:${input.avatarUrl}`,
      expressionProfileRef: null,
      idlePreset: 'cbdb.reviewed-portrait.static',
      interactionPolicyRef: 'cbdb.reviewed-portrait.readonly',
      defaultVoiceReference: parseOptionalString(input.record.defaultVoiceReference)
        || parseOptionalString(input.agentProfile?.defaultVoiceReference)
        || parseDefaultVoiceReferenceFromDna(input.agentProfile?.dna),
    };
  }
  return null;
}

function parseDefaultVoiceReferenceFromDna(value: unknown): string | null {
  const dna = parseOptionalJsonObject(value);
  const voice = parseOptionalJsonObject(dna?.voice);
  const voiceId = parseOptionalString(voice?.voiceId);
  if (!voiceId) {
    return null;
  }
  return `preset_voice_id:${voiceId}`;
}

function parseSpeechSynthesisFromDna(value: unknown): AgentLocalTargetSnapshot['speechSynthesis'] {
  const dna = parseOptionalJsonObject(value);
  const voice = parseOptionalJsonObject(dna?.voice);
  const modelId = parseOptionalString(voice?.speechModelId);
  const routePolicy = parseOptionalString(voice?.speechRoutePolicy);
  if (!modelId || (routePolicy !== 'local' && routePolicy !== 'cloud')) {
    return null;
  }
  return {
    modelId,
    routePolicy,
  };
}

function parseSelectedOwnerSettingFields(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((item) => parseOptionalString(item))
      .filter((item): item is string => Boolean(item)),
  )).sort();
}

function parseOwnerSettingsProjection(
  value: unknown,
): AgentLocalTargetSnapshot['ownerSettingsProjection'] {
  const record = parseOptionalJsonObject(value);
  if (!record) {
    return null;
  }
  const agentRuleVersion = parseOptionalNumber(record.agentRuleVersion) ?? null;
  const selectedOwnerSettingFields = parseSelectedOwnerSettingFields(
    record.selectedOwnerSettingFields,
  );
  const communicationStyle = parseOptionalString(record.communicationStyle) || null;
  if (agentRuleVersion === null && selectedOwnerSettingFields.length === 0 && !communicationStyle) {
    return null;
  }
  return {
    agentRuleVersion,
    selectedOwnerSettingFields,
    communicationStyle,
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

export function mergeAgentTargetWithLocalVoicePolicy(
  target: AgentLocalTargetSnapshot | null,
  input: { avatarAutoplay?: boolean | null } | null | undefined,
): AgentLocalTargetSnapshot | null {
  if (!target) {
    return null;
  }
  const nextAvatarAutoplay = input?.avatarAutoplay === true;
  if ((target.avatarAutoplay ?? false) === nextAvatarAutoplay) {
    return target;
  }
  return {
    ...target,
    avatarAutoplay: nextAvatarAutoplay,
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
  const nextDefaultVoiceReference = liveTarget.defaultVoiceReference
    ?? threadTarget.defaultVoiceReference
    ?? null;
  const nextSpeechSynthesis = liveTarget.speechSynthesis
    ?? threadTarget.speechSynthesis
    ?? null;
  const nextAvatarAutoplay = liveTarget.avatarAutoplay
    ?? threadTarget.avatarAutoplay
    ?? null;
  const nextOwnerSettingsProjection = liveTarget.ownerSettingsProjection
    ?? threadTarget.ownerSettingsProjection
    ?? null;
  if (
    nextGreeting === (threadTarget.greeting ?? null)
    && nextDocs === (threadTarget.builtinDocsContext ?? null)
    && nextDefaultVoiceReference === (threadTarget.defaultVoiceReference ?? null)
    && areSpeechSynthesisRoutesEqual(nextSpeechSynthesis, threadTarget.speechSynthesis ?? null)
    && (nextAvatarAutoplay ?? false) === (threadTarget.avatarAutoplay ?? false)
    && areOwnerSettingsProjectionsEqual(
      nextOwnerSettingsProjection,
      threadTarget.ownerSettingsProjection ?? null,
    )
    && merged === threadTarget
  ) {
    return threadTarget;
  }
  return {
    ...merged,
    greeting: nextGreeting,
    builtinDocsContext: nextDocs,
    defaultVoiceReference: nextDefaultVoiceReference,
    speechSynthesis: nextSpeechSynthesis,
    avatarAutoplay: nextAvatarAutoplay,
    ownerSettingsProjection: nextOwnerSettingsProjection,
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

function areOwnerSettingsProjectionsEqual(
  left: AgentLocalTargetSnapshot['ownerSettingsProjection'] | null | undefined,
  right: AgentLocalTargetSnapshot['ownerSettingsProjection'] | null | undefined,
): boolean {
  const leftProjection = left ?? null;
  const rightProjection = right ?? null;
  if (!leftProjection && !rightProjection) {
    return true;
  }
  if (!leftProjection || !rightProjection) {
    return false;
  }
  return (leftProjection.agentRuleVersion ?? null) === (rightProjection.agentRuleVersion ?? null)
    && (leftProjection.communicationStyle || null) === (rightProjection.communicationStyle || null)
    && leftProjection.selectedOwnerSettingFields.length === rightProjection.selectedOwnerSettingFields.length
    && leftProjection.selectedOwnerSettingFields.every(
      (field, index) => field === rightProjection.selectedOwnerSettingFields[index],
    );
}

function areSpeechSynthesisRoutesEqual(
  left: AgentLocalTargetSnapshot['speechSynthesis'] | null | undefined,
  right: AgentLocalTargetSnapshot['speechSynthesis'] | null | undefined,
): boolean {
  const leftRoute = left ?? null;
  const rightRoute = right ?? null;
  if (!leftRoute && !rightRoute) {
    return true;
  }
  if (!leftRoute || !rightRoute) {
    return false;
  }
  return leftRoute.modelId === rightRoute.modelId
    && leftRoute.routePolicy === rightRoute.routePolicy;
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
    && (left.defaultVoiceReference || null) === (right.defaultVoiceReference || null)
    && areSpeechSynthesisRoutesEqual(left.speechSynthesis, right.speechSynthesis)
    && (left.avatarAutoplay ?? false) === (right.avatarAutoplay ?? false)
    && (left.worldId || null) === (right.worldId || null)
    && (left.worldName || null) === (right.worldName || null)
    && (left.bio || null) === (right.bio || null)
    && (left.ownershipType || null) === (right.ownershipType || null)
    && arePresentationProfilesEqual(left.presentationProfile, right.presentationProfile)
    && areOwnerSettingsProjectionsEqual(
      left.ownerSettingsProjection,
      right.ownerSettingsProjection,
    );
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
  const agentDna = agentProfile?.dna;
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef: buildRuntimeLocalAgentRef({ ownerUserId, realmAgentId }),
    displayName: parseRequiredString(record.displayName, 'displayName', 'agent friend target'),
    handle: parseRequiredString(record.handle, 'handle', 'agent friend target'),
    avatarUrl,
    defaultVoiceReference: parseOptionalString(record.defaultVoiceReference)
      || parseOptionalString(agentProfile?.defaultVoiceReference)
      || parseDefaultVoiceReferenceFromDna(agentDna),
    speechSynthesis: parseSpeechSynthesisFromDna(agentDna),
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
    ownerSettingsProjection: parseOwnerSettingsProjection(agentProfile?.ownerSettingsProjection),
  };
}

export function toAgentFriendTargetsFromSocialSnapshot(
  snapshot: { friends?: readonly unknown[]; ownerUserId?: unknown; currentUserId?: unknown; userId?: unknown; viewerId?: unknown } | null | undefined,
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
