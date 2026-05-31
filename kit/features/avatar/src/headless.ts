export type {
  AvatarAttentionTarget,
  AvatarStageBackendRenderer,
  AvatarBackendKind,
  AvatarEmotionCue,
  AvatarInteractionAdapter,
  AvatarInteractionState,
  AvatarPresentationAdapter,
  AvatarPresentationProfile,
  AvatarStageRendererContext,
  AvatarStageRendererModel,
  AvatarStageRendererRegistry,
  AvatarStageSize,
  AvatarStageSnapshot,
  AvatarStageTone,
  AvatarSurfacePhase,
  RuntimeAgentPresentationAdapter,
  RuntimeAgentPresentationRecord,
} from './types.js';
export type {
  AgentVoicePlaybackCue,
  AgentVoicePlaybackEstimatorFrame,
  AgentVoicePlaybackVisemeId,
} from './voice-playback.js';
export {
  resolveAgentVoicePlaybackAmplitude,
  resolveAgentVoicePlaybackCue,
  resolveAgentVoicePlaybackEstimatedFrame,
  resolveAgentVoicePlaybackVisemeId,
} from './voice-playback.js';

import type {
  AvatarBackendKind,
  AvatarInteractionState,
  AvatarPresentationProfile,
  AvatarStageBackendRenderer,
  AvatarStageRendererModel,
  AvatarStageRendererRegistry,
  AvatarStageSnapshot,
  AvatarStageTone,
} from './types.js';

const DEFAULT_INTERACTION_STATE: AvatarInteractionState = {
  phase: 'idle',
  emotion: 'neutral',
  attentionTarget: 'camera',
  actionCue: null,
  visemeId: null,
  amplitude: null,
};

export function createAvatarStageSnapshot(
  presentation: AvatarPresentationProfile,
  interaction: Partial<AvatarInteractionState> = {},
): AvatarStageSnapshot {
  return {
    presentation,
    interaction: {
      ...DEFAULT_INTERACTION_STATE,
      ...interaction,
    },
  };
}

export function isConcreteAvatarAssetRef(value: string | null | undefined): boolean {
  return Boolean(value) && !String(value).startsWith('fallback://');
}

export function resolveAvatarBackendLabel(backendKind: AvatarBackendKind): string {
  switch (backendKind) {
    case 'vrm':
      return 'VRM';
    case 'live2d':
    default:
      return 'Live2D';
  }
}

function createFallbackPresentationProfile(
  backendKind: AvatarBackendKind,
  avatarAssetRef: string,
): AvatarPresentationProfile {
  return {
    backendKind,
    avatarAssetRef,
    expressionProfileRef: null,
    idlePreset: null,
    interactionPolicyRef: null,
    defaultVoiceReference: null,
  };
}

export function resolveAvatarPresentationProfile(input: {
  presentation?: AvatarPresentationProfile | null;
  fallbackAssetRef?: string | null;
  fallbackBackendKind?: AvatarBackendKind;
  fallbackProfileRef?: string;
}): AvatarPresentationProfile {
  if (input.presentation) {
    return input.presentation;
  }
  if (input.fallbackAssetRef) {
    return createFallbackPresentationProfile(input.fallbackBackendKind || 'live2d', input.fallbackAssetRef);
  }
  return createFallbackPresentationProfile('live2d', input.fallbackProfileRef || 'fallback://avatar-stage');
}

export function resolveAvatarStagePosterUrl(
  _presentation: AvatarPresentationProfile | null | undefined,
  fallbackImageUrl?: string | null,
): string | null {
  return fallbackImageUrl || null;
}

export function resolveAvatarStageRendererModel(input: {
  presentation: AvatarPresentationProfile;
  imageUrl?: string | null;
}): AvatarStageRendererModel {
  const { presentation } = input;
  const concreteAssetRef = isConcreteAvatarAssetRef(presentation.avatarAssetRef) ? presentation.avatarAssetRef : null;
  switch (presentation.backendKind) {
    case 'vrm':
      return {
        kind: 'vrm',
        assetRef: presentation.avatarAssetRef,
        mediaUrl: concreteAssetRef,
        posterUrl: input.imageUrl || null,
        backendLabel: resolveAvatarBackendLabel('vrm'),
        prefersMotion: true,
      };
    case 'live2d':
      return {
        kind: 'live2d',
        assetRef: presentation.avatarAssetRef,
        mediaUrl: concreteAssetRef,
        posterUrl: input.imageUrl || null,
        backendLabel: resolveAvatarBackendLabel('live2d'),
        prefersMotion: true,
      };
    default:
      return {
        kind: 'live2d',
        assetRef: presentation.avatarAssetRef,
        mediaUrl: concreteAssetRef,
        posterUrl: input.imageUrl || null,
        backendLabel: resolveAvatarBackendLabel('live2d'),
        prefersMotion: true,
      };
  }
}

export function resolveAvatarStageBackendRenderer(input: {
  backendKind: AvatarBackendKind;
  renderers?: AvatarStageRendererRegistry | null;
  defaults: Record<AvatarBackendKind, AvatarStageBackendRenderer>;
}): AvatarStageBackendRenderer {
  return input.renderers?.[input.backendKind]
    || input.defaults[input.backendKind]
    || input.defaults.live2d;
}

export function inferAvatarEmotionFromPhase(phase: AvatarInteractionState['phase']): AvatarInteractionState['emotion'] {
  switch (phase) {
    case 'thinking':
      return 'focus';
    case 'listening':
      return 'calm';
    case 'speaking':
      return 'joy';
    case 'transitioning':
      return 'surprised';
    case 'idle':
    default:
      return 'neutral';
  }
}

export function inferAvatarToneFromEmotion(emotion: AvatarInteractionState['emotion']): AvatarStageTone {
  switch (emotion) {
    case 'joy':
      return 'amber';
    case 'playful':
      return 'rose';
    case 'focus':
      return 'sky';
    case 'calm':
      return 'mint';
    case 'concerned':
      return 'slate';
    case 'surprised':
      return 'rose';
    case 'neutral':
    default:
      return 'mint';
  }
}
