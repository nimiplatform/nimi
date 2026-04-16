import type { AvatarPresentationProfile, AvatarStageSnapshot } from '@nimiplatform/nimi-kit/features/avatar/headless';
import type { AvatarVrmViewportRenderInput } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { DesktopAgentAvatarResourceRecord } from '@renderer/bridge/runtime-bridge/types';
import {
  createIdleChatAgentAvatarPointerInteractionState,
  type ChatAgentAvatarPointerInteractionState,
} from './chat-agent-avatar-pointer-interaction';

function buildDesktopAgentAvatarAssetRef(resource: DesktopAgentAvatarResourceRecord): string {
  return `desktop-avatar://${resource.resourceId}/${encodeURIComponent(resource.sourceFilename)}`;
}

function resolveFallbackPhaseLabel(
  phase: NonNullable<ConversationCharacterData['interactionState']>['phase'] | null | undefined,
): string {
  switch (phase) {
    case 'thinking':
      return 'Thinking';
    case 'listening':
      return 'Listening';
    case 'speaking':
      return 'Speaking';
    case 'loading':
      return 'Transitioning';
    case 'idle':
    default:
      return 'Here with you';
  }
}

function resolveBaselineAvatarPresentationProfile(input: {
  presentationProfile?: AvatarPresentationProfile | null;
  avatarUrl?: string | null;
}): AvatarPresentationProfile {
  const presentationProfile = input.presentationProfile || null;
  if (presentationProfile) {
    return presentationProfile;
  }
  if (input.avatarUrl) {
    return {
      backendKind: 'sprite2d',
      avatarAssetRef: input.avatarUrl,
      expressionProfileRef: null,
      idlePreset: null,
      interactionPolicyRef: null,
      defaultVoiceReference: null,
    };
  }
  return {
    backendKind: 'canvas2d',
    avatarAssetRef: 'fallback://agent-live-rail',
    expressionProfileRef: null,
    idlePreset: null,
    interactionPolicyRef: null,
    defaultVoiceReference: null,
  };
}

function resolveDesktopLocalPresentationProfile(
  localResource: DesktopAgentAvatarResourceRecord | null,
): AvatarPresentationProfile | null {
  if (localResource?.kind === 'vrm' && localResource.status === 'ready') {
    return {
      backendKind: 'vrm',
      avatarAssetRef: buildDesktopAgentAvatarAssetRef(localResource),
      expressionProfileRef: 'desktop://agent-local-avatar/default-expression-profile',
      idlePreset: 'desktop-agent-local-avatar-idle',
      interactionPolicyRef: 'desktop://agent-local-avatar/default-interaction-policy',
      defaultVoiceReference: null,
    };
  }
  if (localResource?.kind === 'live2d' && localResource.status === 'ready') {
    return {
      backendKind: 'live2d',
      avatarAssetRef: buildDesktopAgentAvatarAssetRef(localResource),
      expressionProfileRef: 'desktop://agent-local-avatar/live2d-expression-profile',
      idlePreset: 'desktop-agent-local-live2d-idle',
      interactionPolicyRef: 'desktop://agent-local-avatar/live2d-interaction-policy',
      defaultVoiceReference: null,
    };
  }
  return null;
}

function buildAvatarSnapshot(input: {
  presentation: AvatarPresentationProfile;
  interactionState: ConversationCharacterData['interactionState'] | null | undefined;
  statusLabel: string;
  pointerInteraction: ChatAgentAvatarPointerInteractionState;
}): AvatarStageSnapshot {
  const interactionState = input.interactionState || null;
  return {
    presentation: input.presentation,
    interaction: {
      phase: interactionState?.phase === 'loading'
        ? 'transitioning'
        : interactionState?.phase === 'thinking'
          ? 'thinking'
          : interactionState?.phase === 'listening'
            ? 'listening'
            : interactionState?.phase === 'speaking'
              ? 'speaking'
              : 'idle',
      emotion: interactionState?.emotion || 'calm',
      actionCue: input.statusLabel,
      attentionTarget: input.pointerInteraction.hovered ? 'pointer' : 'camera',
      amplitude: typeof interactionState?.amplitude === 'number' ? interactionState.amplitude : 0.12,
      visemeId: interactionState?.visemeId || null,
    },
  };
}

export type ChatAgentLiveAvatarRailModel = {
  displayName: string;
  statusLabel: string;
  presentation: AvatarPresentationProfile;
  fallbackPresentation: AvatarPresentationProfile;
  pointerInteraction: ChatAgentAvatarPointerInteractionState;
  snapshot: AvatarStageSnapshot;
  fallbackSnapshot: AvatarStageSnapshot;
  viewportInput: AvatarVrmViewportRenderInput;
};

export function resolveChatAgentLiveAvatarRailModel(input: {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  localResource?: DesktopAgentAvatarResourceRecord | null;
  pointerInteraction?: ChatAgentAvatarPointerInteractionState | null;
}): ChatAgentLiveAvatarRailModel {
  const displayName = input.characterData?.name || input.selectedTarget.title || 'Agent';
  const interactionState = input.characterData?.interactionState || null;
  const statusLabel = interactionState?.label || resolveFallbackPhaseLabel(interactionState?.phase);
  const pointerInteraction = input.pointerInteraction || createIdleChatAgentAvatarPointerInteractionState();
  const fallbackPresentation = resolveBaselineAvatarPresentationProfile({
    presentationProfile: input.characterData?.avatarPresentationProfile || null,
    avatarUrl: input.characterData?.avatarUrl || input.selectedTarget.avatarUrl || null,
  });
  const presentation = resolveDesktopLocalPresentationProfile(input.localResource || null) || fallbackPresentation;
  const snapshot = buildAvatarSnapshot({
    presentation,
    interactionState,
    statusLabel,
    pointerInteraction,
  });
  const fallbackSnapshot = buildAvatarSnapshot({
    presentation: fallbackPresentation,
    interactionState,
    statusLabel,
    pointerInteraction,
  });

  return {
    displayName,
    statusLabel,
    presentation,
    fallbackPresentation,
    pointerInteraction,
    snapshot,
    fallbackSnapshot,
    viewportInput: {
      label: displayName,
      assetRef: presentation.avatarAssetRef,
      posterUrl: input.characterData?.avatarUrl || input.selectedTarget.avatarUrl || null,
      idlePreset: presentation.idlePreset || null,
      expressionProfileRef: presentation.expressionProfileRef || null,
      interactionPolicyRef: presentation.interactionPolicyRef || null,
      defaultVoiceReference: presentation.defaultVoiceReference || null,
      snapshot,
    },
  };
}
