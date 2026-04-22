import type { AvatarPresentationProfile, AvatarStageSnapshot } from '@nimiplatform/nimi-kit/features/avatar/headless';
import type { AvatarVrmViewportRenderInput } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { DesktopAgentAvatarResourceRecord } from '@renderer/bridge/runtime-bridge/types';
import {
  createIdleChatAgentAvatarAttentionState,
  type ChatAgentAvatarAttentionState,
} from './chat-agent-avatar-attention-state';

type ChatAgentAvatarSmokeInteractionOverride = {
  phase?: NonNullable<ConversationCharacterData['interactionState']>['phase'];
  label?: string;
  emotion?: NonNullable<ConversationCharacterData['interactionState']>['emotion'];
  amplitude?: number;
  visemeId?: NonNullable<ConversationCharacterData['interactionState']>['visemeId'];
};

export const CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT = 'nimi:chat-avatar-smoke-override-change';

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
  if (presentationProfile && presentationProfile.backendKind !== 'live2d' && presentationProfile.backendKind !== 'vrm') {
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
    avatarAssetRef: 'fallback://agent-avatar-stage',
    expressionProfileRef: null,
    idlePreset: null,
    interactionPolicyRef: null,
    defaultVoiceReference: null,
  };
}

export function resolveDesktopChatAvatarPresentationProfile(input: {
  presentationProfile?: AvatarPresentationProfile | null;
  avatarUrl?: string | null;
}): AvatarPresentationProfile {
  const fallbackPresentation = resolveBaselineAvatarPresentationProfile(input);
  const presentationProfile = input.presentationProfile || null;
  if (!presentationProfile) {
    return fallbackPresentation;
  }
  if (presentationProfile.backendKind === 'live2d' || presentationProfile.backendKind === 'vrm') {
    return fallbackPresentation;
  }
  return presentationProfile;
}

function buildAvatarSnapshot(input: {
  presentation: AvatarPresentationProfile;
  interactionState: ConversationCharacterData['interactionState'] | null | undefined;
  statusLabel: string;
  attentionState: ChatAgentAvatarAttentionState;
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
      attentionTarget: input.attentionState.active ? 'pointer' : 'camera',
      amplitude: typeof interactionState?.amplitude === 'number' ? interactionState.amplitude : 0.12,
      visemeId: interactionState?.visemeId || null,
    },
  };
}

function resolveChatAgentAvatarSmokeInteractionOverride(): ChatAgentAvatarSmokeInteractionOverride | null {
  const value = (globalThis as typeof globalThis & {
    __NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__?: unknown;
    __NIMI_LIVE2D_SMOKE_OVERRIDE__?: unknown;
  }).__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__
    ?? (globalThis as typeof globalThis & {
      __NIMI_LIVE2D_SMOKE_OVERRIDE__?: unknown;
    }).__NIMI_LIVE2D_SMOKE_OVERRIDE__;
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const phase = typeof record.phase === 'string'
    && ['idle', 'thinking', 'listening', 'speaking', 'loading'].includes(record.phase)
    ? record.phase as NonNullable<ConversationCharacterData['interactionState']>['phase']
    : undefined;
  const label = typeof record.label === 'string' && record.label.trim().length > 0 ? record.label.trim() : undefined;
  const emotion = typeof record.emotion === 'string' && record.emotion.trim().length > 0
    ? record.emotion as NonNullable<ConversationCharacterData['interactionState']>['emotion']
    : undefined;
  const amplitude = typeof record.amplitude === 'number' && Number.isFinite(record.amplitude)
    ? Math.max(0, Math.min(record.amplitude, 1))
    : undefined;
  const visemeId = typeof record.visemeId === 'string' && record.visemeId.trim().length > 0
    ? record.visemeId as NonNullable<ConversationCharacterData['interactionState']>['visemeId']
    : undefined;
  if (!phase && !label && !emotion && amplitude == null && !visemeId) {
    return null;
  }
  return {
    phase,
    label,
    emotion,
    amplitude,
    visemeId,
  };
}

function resolveChatAgentAvatarInteractionState(
  interactionState: ConversationCharacterData['interactionState'] | null | undefined,
): ConversationCharacterData['interactionState'] | null {
  const smokeOverride = resolveChatAgentAvatarSmokeInteractionOverride();
  if (!smokeOverride) {
    return interactionState || null;
  }
  return {
    phase: smokeOverride.phase || interactionState?.phase || 'idle',
    label: smokeOverride.label || interactionState?.label || null,
    emotion: smokeOverride.emotion || interactionState?.emotion || null,
    amplitude: smokeOverride.amplitude ?? interactionState?.amplitude ?? 0,
    visemeId: smokeOverride.visemeId ?? interactionState?.visemeId ?? null,
  };
}

export type ChatAgentAvatarStageModel = {
  displayName: string;
  statusLabel: string;
  imageUrl: string | null;
  fallbackLabel: string;
  presentation: AvatarPresentationProfile;
  fallbackPresentation: AvatarPresentationProfile;
  attentionState: ChatAgentAvatarAttentionState;
  snapshot: AvatarStageSnapshot;
  fallbackSnapshot: AvatarStageSnapshot;
  viewportInput: AvatarVrmViewportRenderInput;
};

export type ChatAgentAvatarStageRenderModel = {
  label: string;
  imageUrl: string | null;
  fallbackLabel: string;
  attentionState: ChatAgentAvatarAttentionState;
  snapshot: AvatarStageSnapshot;
  viewportInput: AvatarVrmViewportRenderInput;
  rendererFallbackApplied: boolean;
};

export function resolveChatAgentAvatarStageModel(input: {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  localResource?: DesktopAgentAvatarResourceRecord | null;
  attentionState?: ChatAgentAvatarAttentionState | null;
}): ChatAgentAvatarStageModel {
  void input.localResource;
  const displayName = input.characterData?.name || input.selectedTarget.title || 'Agent';
  const interactionState = resolveChatAgentAvatarInteractionState(input.characterData?.interactionState || null);
  const statusLabel = interactionState?.label || resolveFallbackPhaseLabel(interactionState?.phase);
  const attentionState = input.attentionState || createIdleChatAgentAvatarAttentionState();
  const presentation = resolveDesktopChatAvatarPresentationProfile({
    presentationProfile: input.characterData?.avatarPresentationProfile || null,
    avatarUrl: input.characterData?.avatarUrl || input.selectedTarget.avatarUrl || null,
  });
  const snapshot = buildAvatarSnapshot({
    presentation,
    interactionState,
    statusLabel,
    attentionState,
  });

  return {
    displayName,
    statusLabel,
    imageUrl: input.characterData?.avatarUrl || input.selectedTarget.avatarUrl || null,
    fallbackLabel: input.selectedTarget.avatarFallback || displayName,
    presentation,
    fallbackPresentation: presentation,
    attentionState,
    snapshot,
    fallbackSnapshot: snapshot,
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

export function resolveChatAgentAvatarStageRenderModel(input: {
  stageModel: ChatAgentAvatarStageModel;
  loadStatus?: {
    live2d: 'idle' | 'loading' | 'ready' | 'error';
    vrm: 'idle' | 'loading' | 'ready' | 'error';
  };
}): ChatAgentAvatarStageRenderModel {
  void input.loadStatus;
  return {
    label: input.stageModel.displayName,
    imageUrl: input.stageModel.imageUrl,
    fallbackLabel: input.stageModel.fallbackLabel,
    attentionState: input.stageModel.attentionState,
    snapshot: input.stageModel.snapshot,
    viewportInput: {
      ...input.stageModel.viewportInput,
      assetRef: input.stageModel.snapshot.presentation.avatarAssetRef,
      snapshot: input.stageModel.snapshot,
    },
    rendererFallbackApplied: false,
  };
}
