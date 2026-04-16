import type { CSSProperties, ReactNode } from 'react';

export type AvatarBackendKind = 'vrm' | 'sprite2d' | 'canvas2d' | 'video';

export type AvatarSurfacePhase =
  | 'idle'
  | 'thinking'
  | 'listening'
  | 'speaking'
  | 'transitioning';

export type AvatarEmotionCue =
  | 'neutral'
  | 'joy'
  | 'focus'
  | 'calm'
  | 'playful'
  | 'concerned'
  | 'surprised';

export type AvatarAttentionTarget = 'camera' | 'content' | 'pointer' | 'none';

export type AvatarPresentationProfile = {
  backendKind: AvatarBackendKind;
  avatarAssetRef: string;
  expressionProfileRef?: string | null;
  idlePreset?: string | null;
  interactionPolicyRef?: string | null;
  defaultVoiceReference?: string | null;
};

export type AvatarInteractionState = {
  phase: AvatarSurfacePhase;
  emotion?: AvatarEmotionCue | null;
  attentionTarget?: AvatarAttentionTarget | null;
  actionCue?: string | null;
  visemeId?: string | null;
  amplitude?: number | null;
};

export type AvatarStageSnapshot = {
  presentation: AvatarPresentationProfile;
  interaction: AvatarInteractionState;
};

export type AvatarStageTone = 'mint' | 'sky' | 'amber' | 'rose' | 'slate';

export type AvatarStageSize = 'sm' | 'md' | 'lg';

export type AvatarStageRendererModel = {
  kind: AvatarBackendKind;
  assetRef: string;
  mediaUrl: string | null;
  posterUrl: string | null;
  backendLabel: string;
  prefersMotion: boolean;
};

export type AvatarStageRendererContext = {
  snapshot: AvatarStageSnapshot;
  label: string;
  fallback: ReactNode;
  renderer: AvatarStageRendererModel;
  size: AvatarStageSize;
  frameClassName: string;
  style?: CSSProperties;
};

export type AvatarStageBackendRenderer = (
  context: AvatarStageRendererContext,
) => ReactNode;

export type AvatarStageRendererRegistry = Partial<Record<AvatarBackendKind, AvatarStageBackendRenderer>>;

export type RuntimeAgentPresentationRecord = {
  agentId: string;
  presentation: AvatarPresentationProfile;
};

export type AvatarPresentationAdapter = {
  getPresentationProfile: () => AvatarPresentationProfile;
};

export type AvatarInteractionAdapter = {
  getInteractionState: () => AvatarInteractionState;
};

export type RuntimeAgentPresentationAdapter = {
  getAgentPresentation: (agentId: string) => Promise<RuntimeAgentPresentationRecord>;
};
