import type {
  ConversationMessageViewModel,
} from '@nimiplatform/kit/features/chat/headless';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';
import type {
  AgentLocalMessageRecord,
  AgentLocalTargetSnapshot,
} from '@renderer/bridge/runtime-bridge/types';
import {
  parseOptionalString,
} from '@nimiplatform/kit/shell/renderer/bridge';

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
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
 * Overlay live runtime source profile content onto a
 * persisted thread target.
 *
 * A persisted thread `targetSnapshot` carries durable identity but does not
 * round-trip live source profile content (`presentationProfile`, `greeting`,
 * `builtinDocsContext`). The live runtime source target is the source of truth
 * for that content at chat time.
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
    && left.runtimeSourceRef === right.runtimeSourceRef
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
