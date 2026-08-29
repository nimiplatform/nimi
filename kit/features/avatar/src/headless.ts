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
  AudioPipelineController,
  getSharedAudioPipelineController,
  SYNTHETIC_AUDIO_MIME_TYPE,
} from './audio-pipeline.js';
export type {
  AudioPipelineListener,
  AudioPipelinePlayInput,
  AudioPlaybackSnapshot,
  AudioPlaybackState,
  AvatarAudioPipelineSink,
  AvatarAudioPipelineSinkSnapshot,
} from './audio-pipeline.js';
export {
  createWLipSyncAudioConsumer,
} from './wlipsync-audio-consumer.js';
export type {
  WLipSyncAudioConsumer,
  WLipSyncAudioConsumerDeps,
  WLipSyncAudioConsumerFactory,
  WLipSyncAudioNode,
} from './wlipsync-audio-consumer.js';
export {
  resolveAgentVoicePlaybackAmplitude,
  resolveAgentVoicePlaybackCue,
  resolveAgentVoicePlaybackEstimatedFrame,
  resolveAgentVoicePlaybackVisemeId,
} from './voice-playback.js';
export {
  createAvatarHitRegionSnapshot,
  hitTestAvatarRegion,
  rectFromElement,
} from './avatar-hit-region.js';
export type {
  AvatarHitRegionName,
  AvatarHitRegionRect,
  AvatarHitRegionSnapshot,
  AvatarHitTestPoint,
  AvatarHitTestResult,
} from './avatar-hit-region.js';
export type {
  ActivityFallbackOptions,
  AvatarActivityFallbackBundle,
  EmbodimentProjectionApi,
  MotionPriority,
  PlayMotionOptions,
  ProjectionBounds,
} from './avatar-cue-projection.js';
export {
  createSmoothedProjection,
  PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS,
} from './avatar-projection-smoothing.js';
export type {
  CreateSmoothedProjectionInput,
  ProjectionSmoothingHandle,
  ProjectionSmoothingStats,
} from './avatar-projection-smoothing.js';
export {
  getSharedVoiceLipsyncStateBus,
  VoiceLipsyncStateBus,
} from './voice-lipsync-state-bus.js';
export type {
  VoiceLipsyncStateBusEvent,
  VoiceLipsyncStateBusListener,
} from './voice-lipsync-state-bus.js';
export type {
  AvatarModelManifest,
  Live2DAvatarModelManifest,
  Live2DLocalModelManifest,
  TauriAvatarModelManifest,
  VrmAvatarModelManifest,
} from './avatar-model-manifest.js';
export type {
  BackendAudioConsumer,
  BackendHitRegion,
  BackendKind,
  BackendNominalBounds,
  WLipSyncSnapshot,
} from './backend-branch.js';
export {
  fromLive2DLocalModelManifest,
  fromTauriAvatarModelManifest,
} from './avatar-model-manifest.js';
export {
  assertLive2DCompatibilitySupported,
  DEFAULT_MOUTH_OPEN_PARAMETER,
  LIVE2D_ADAPTER_MANIFEST_KIND,
  parseLive2DAdapterManifest,
  validateLive2DCompatibility,
} from './live2d-compatibility.js';
export type {
  Live2DAdapterManifestV1,
  Live2DCompatibilityDiagnostic,
  Live2DCompatibilityDiagnosticCode,
  Live2DCompatibilityInput,
  Live2DCompatibilityModelManifest,
  Live2DCompatibilityModelSettings,
  Live2DCompatibilityReport,
  Live2DCompatibilityResources,
  Live2DCompatibilityTier,
  Live2DFeatureDisposition,
} from './live2d-compatibility.js';
export {
  computeLive2DHitRegion,
  createLive2DHitRegion,
  LIVE2D_ALPHA_MASK_THRESHOLD,
  LIVE2D_ALPHA_MASK_THRESHOLD_BYTE,
  LIVE2D_DEFAULT_HIT_REGION,
} from './live2d-hit-region.js';
export type {
  CreateLive2DHitRegionInputs,
  Live2DHitRegionDegradedDetail,
  Live2DHitRegionDeviceTier,
  Live2DHitRegionInput,
} from './live2d-hit-region.js';
export {
  createVrmHitRegion,
  VRM_ALPHA_MASK_THRESHOLD,
  VRM_ALPHA_MASK_THRESHOLD_BYTE,
} from './vrm-hit-region.js';
export type {
  CreateVrmHitRegionInputs,
  VrmHitRegionDegradedDetail,
  VrmHitRegionDeviceTier,
  VrmHitRegionRenderTarget,
} from './vrm-hit-region.js';
export {
  computeLive2DNominalBounds,
  LIVE2D_FALLBACK_NOMINAL_BOUNDS,
} from './live2d-nominal-bounds.js';
export type {
  Live2DNominalBoundsInput,
  Live2DNominalBoundsModel,
} from './live2d-nominal-bounds.js';
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

export function resolveAvatarBackendLabel(backendKind: AvatarBackendKind): string {
  switch (backendKind) {
    case 'vrm':
      return 'VRM';
    case 'sprite2d':
      return 'Sprite 2D';
    case 'canvas2d':
      return 'Canvas 2D';
    case 'video':
      return 'Video';
    case 'live2d':
    default:
      return 'Live2D';
  }
}

function resolveAvatarAssetMediaUrl(avatarAssetRef: string | null | undefined): string | null {
  if (!avatarAssetRef) {
    return null;
  }
  const normalized = String(avatarAssetRef);
  const profileMediaPrefix = 'profile_media_url:';
  if (normalized.startsWith(profileMediaPrefix)) {
    return normalized.slice(profileMediaPrefix.length) || null;
  }
  return normalized;
}

export function resolveAvatarStageRendererModel(input: {
  presentation: AvatarPresentationProfile;
  imageUrl?: string | null;
}): AvatarStageRendererModel {
  const { presentation } = input;
  const concreteAssetRef = resolveAvatarAssetMediaUrl(presentation.avatarAssetRef);
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
    case 'sprite2d':
      return {
        kind: 'sprite2d',
        assetRef: presentation.avatarAssetRef,
        mediaUrl: concreteAssetRef,
        posterUrl: input.imageUrl || concreteAssetRef,
        backendLabel: resolveAvatarBackendLabel('sprite2d'),
        prefersMotion: false,
      };
    case 'canvas2d':
      return {
        kind: 'canvas2d',
        assetRef: presentation.avatarAssetRef,
        mediaUrl: concreteAssetRef,
        posterUrl: input.imageUrl || null,
        backendLabel: resolveAvatarBackendLabel('canvas2d'),
        prefersMotion: true,
      };
    case 'video':
      return {
        kind: 'video',
        assetRef: presentation.avatarAssetRef,
        mediaUrl: concreteAssetRef,
        posterUrl: input.imageUrl || null,
        backendLabel: resolveAvatarBackendLabel('video'),
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

export {
  isAvatarControlledPreviewSurfaceRef,
  normalizeAvatarControlledPreviewSurfaceRef,
} from './preview-surface-ref.js';
export {
  resolveAgentCenterAvatarPreviewServiceResult,
} from './agent-center-preview.js';
export type {
  AgentCenterAvatarPreviewServiceResult,
  ResolveAgentCenterAvatarPreviewServiceInput,
} from './agent-center-preview.js';
export {
  buildAvatarLaunchHandoffPayload,
  buildAvatarLaunchInstanceId,
  parseAvatarLaunchHandoffPayload,
  parseAvatarLaunchHandoffResult,
  parseAvatarRendererLaunchContext,
} from './launch-handoff.js';
export type {
  AvatarLaunchHandoffPayload,
  AvatarLaunchHandoffPayloadInput,
  AvatarLaunchHandoffResult,
  AvatarLaunchInstanceIdInput,
  AvatarRendererLaunchContext,
} from './launch-handoff.js';
export {
  buildAvatarHostHandoffRequest,
  invokeAvatarHostHandoff,
  parseAvatarHostHandoffResult,
} from './host-handoff-port.js';
export type {
  AvatarHostHandoffCommand,
  AvatarHostHandoffPort,
  AvatarHostHandoffRequest,
  AvatarHostHandoffResult,
  AvatarHostHandoffTarget,
  AvatarHostPresenceState,
} from './host-handoff-port.js';
export {
  AVATAR_INSTANCE_POLICY_VALUES,
  arbitrateAvatarLaunch,
  evaluateStartWithChatGate,
} from './launch-arbitration.js';
export type {
  AvatarInstancePolicy,
  AvatarLaunchArbitrationFailClosedState,
  AvatarLaunchArbitrationInput,
  AvatarLaunchArbitrationResult,
  AvatarLaunchTrigger,
  AvatarLiveInstanceView,
  AvatarRuntimeProjectionAuthorization,
  StartWithChatGateConditionId,
  StartWithChatGateConditionResult,
  StartWithChatGateInput,
  StartWithChatGateResult,
} from './launch-arbitration.js';
export {
  mapRuntimeAgentEmotionToAvatarCue,
  parseRuntimeAgentEmotionId,
  parseRuntimeAgentEmotionIntensity,
  RUNTIME_AGENT_EMOTION_IDS,
} from './emotion-mapping.js';
export type {
  RuntimeAgentEmotionId,
  RuntimeAgentEmotionIntensity,
} from './emotion-mapping.js';
