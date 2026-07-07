import type {
  NimiRuntimeAgentAutonomyConfigInput,
  NimiRuntimeAgentAutonomyMode,
  NimiRuntimeAgentAutonomySnapshot,
  NimiRuntimeAgentAIConfigBinding,
  NimiRuntimeAgentAIConfigIntents,
  NimiRuntimeAgentAIConfigModule,
  NimiRuntimeAgentAIConfigReadinessCapabilityState,
  NimiRuntimeAgentAIConfigReadinessReasonCode,
  NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
  NimiRuntimeAgentAIConfigSnapshot,
  NimiRuntimeAgentAIConfigUpsertInput,
  NimiRuntimeAgentCanonicalMemoryInspect,
  NimiRuntimeAgentInspectSnapshot,
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentMemoryObservatorySnapshot,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigLocalAssetSource,
  ModelConfigProviderResolver,
} from '@nimiplatform/kit/core/model-config';

export type AgentCenterCapabilityId =
  | 'text.generate'
  | 'text.embed'
  | 'image.generate'
  | 'audio.synthesize'
  | 'voice_workflow.voice_clone'
  | 'voice_workflow.voice_design';

export type AgentCenterRuntimeAIConfigUpsertInput =
  Omit<NimiRuntimeAgentAIConfigUpsertInput, keyof RuntimeLocalAgentIdentityInput>
  & Partial<RuntimeLocalAgentIdentityInput>;

export type AgentCenterRuntimeAutonomyConfigInput =
  Omit<NimiRuntimeAgentAutonomyConfigInput, keyof RuntimeLocalAgentIdentityInput>
  & Partial<RuntimeLocalAgentIdentityInput>
  & { readonly enabled?: boolean };

export type AgentCenterSectionId =
  | 'overview'
  | 'model'
  | 'behavior'
  | 'cognition'
  | 'appearance'
  | 'advanced';

export type AgentCenterStatusTone =
  | 'ready'
  | 'attention'
  | 'disabled'
  | 'loading'
  | 'failed';

export type AgentCenterRuntimeStatus =
  | 'ready'
  | 'disabled'
  | 'loading'
  | 'failed';

export interface AgentCenterRuntimeAdapter {
  readonly agentAIConfig: NimiRuntimeAgentAIConfigModule;
  readonly inspect?: NimiRuntimeAgentInspectSurface | null;
  readonly modelConfig?: AgentCenterRuntimeModelConfigAdapter | null;
  loadSnapshot(input?: AgentCenterRuntimeLoadInput): Promise<AgentCenterRuntimeSnapshot>;
  upsertAgentAIConfig?(
    input: AgentCenterRuntimeAIConfigUpsertInput,
  ): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  setAutonomyConfig?(
    input: AgentCenterRuntimeAutonomyConfigInput,
  ): Promise<NimiRuntimeAgentAutonomySnapshot>;
}

export interface AgentCenterRuntimeModelConfigAdapter {
  readonly providerResolver?: ModelConfigProviderResolver | null;
  readonly localAssetSource?: ModelConfigLocalAssetSource | null;
}

export interface AgentCenterRuntimeLoadInput {
  readonly identity?: RuntimeLocalAgentIdentityInput;
  readonly subjectUserId?: string;
}

export interface AgentCenterRuntimeSnapshot {
  readonly agentAIConfig?: NimiRuntimeAgentAIConfigSnapshot | null;
  readonly readiness?: NimiRuntimeAgentAIConfigReadinessSnapshotProjection | null;
  readonly inspect?: NimiRuntimeAgentInspectSnapshot | null;
  readonly memory?: NimiRuntimeAgentMemoryObservatorySnapshot | null;
  readonly runtimeError?: string | null;
}

export interface AgentCenterAppearanceProjection {
  readonly status: 'ready' | 'not_configured' | 'invalid' | 'loading';
  readonly backendKind?: string | null;
  readonly avatarAssetRef?: string | null;
  readonly avatarAssetValid?: boolean;
  readonly avatarAssetChecking?: boolean;
  readonly validationStatus?: string | null;
  readonly validationMessage?: string | null;
  readonly validationIssueRows?: readonly string[];
  readonly backendCapabilityProfileRef?: string | null;
  readonly live2dAdapterManifestSource?: 'none' | 'embedded_creator_manifest' | 'external_sidecar_manifest' | string | null;
  readonly live2dAdapterManifestRef?: string | null;
  readonly live2dCalibrationRef?: string | null;
  readonly backgroundRef?: string | null;
  readonly backgroundValid?: boolean;
  readonly backgroundChecking?: boolean;
  readonly backgroundValidationStatus?: string | null;
  readonly backgroundValidationMessage?: string | null;
  readonly backgroundImportError?: string | null;
  readonly defaultVoiceReference?: string | null;
  readonly avatarAutoplay?: boolean;
  readonly avatarImportDisabled?: boolean;
  readonly backgroundImportDisabled?: boolean;
  readonly voiceCleanupPending?: boolean;
  readonly voiceCleanupError?: string | null;
  readonly avatarConfigPending?: boolean;
  readonly avatarImportPending?: boolean;
  readonly live2dAdapterImportPending?: boolean;
  readonly clearAvatarPending?: boolean;
  readonly backgroundImportPending?: boolean;
  readonly clearBackgroundPending?: boolean;
  readonly avatarImportError?: string | null;
  readonly avatarInstancePolicy?: 'reuse_active_instance' | 'launch_new_instance' | 'require_user_selection' | string | null;
  readonly generatedMotionProviderPolicy?: 'require_profile_support' | 'disable_generated_motion' | 'debug_only' | string | null;
  readonly launchMode?: 'manual' | 'debug_session' | 'start_with_chat' | string | null;
  readonly debugProfile?: 'standard' | 'strict_backend_evidence' | 'route_matrix' | string | null;
  readonly developerModeEnabled?: boolean;
  readonly disabledReason?: string | null;
}

export interface AgentCenterAppearanceAdapter {
  readonly load: () => Promise<AgentCenterAppearanceProjection>;
  readonly admitAsset?: (input: AgentCenterAppearanceAssetAdmissionInput) => Promise<AgentCenterAppearanceProjection>;
  readonly importAvatarAsset?: (kind: 'live2d' | 'vrm') => Promise<AgentCenterAppearanceProjection>;
  readonly linkLive2dAdapterManifest?: () => Promise<AgentCenterAppearanceProjection>;
  readonly clearAvatarAsset?: () => Promise<AgentCenterAppearanceProjection>;
  readonly importBackground?: () => Promise<AgentCenterAppearanceProjection>;
  readonly clearBackground?: () => Promise<AgentCenterAppearanceProjection>;
  readonly updateAvatarConfig?: (patch: AgentCenterAppearanceConfigPatch) => Promise<AgentCenterAppearanceProjection>;
  readonly cleanupGeneratedVoiceArtifacts?: () => Promise<AgentCenterAppearanceProjection>;
  readonly setAvatarAutoplay?: (enabled: boolean) => Promise<AgentCenterAppearanceProjection>;
}

export interface AgentCenterAppearanceConfigPatch {
  readonly avatar_instance_policy?: 'reuse_active_instance' | 'launch_new_instance' | 'require_user_selection' | string;
  readonly generated_motion_provider_policy?: 'require_profile_support' | 'disable_generated_motion' | 'debug_only' | string;
  readonly launch_mode?: 'manual' | 'debug_session' | 'start_with_chat' | string;
  readonly debug_profile?: 'standard' | 'strict_backend_evidence' | 'route_matrix' | string;
}

export interface AgentCenterAppearanceAssetAdmissionInput {
  readonly kind: 'avatar' | 'background' | 'calibration-reference';
  readonly localAssetRef: string;
}

export interface AgentCenterPlacementActions {
  readonly close?: () => void;
  readonly openRuntimeSettings?: () => void;
  readonly launchAvatar?: () => void;
}

export interface AgentCenterIdentityProjection {
  readonly displayName: string;
  readonly localAgentRef?: string | null;
  readonly avatarUrl?: string | null;
  readonly avatarFallback?: string | null;
  readonly badgeLabel?: string | null;
}

export interface AgentCenterCapabilityState {
  readonly capability: AgentCenterCapabilityId;
  readonly label: string;
  readonly required: boolean;
  readonly readinessState: NimiRuntimeAgentAIConfigReadinessCapabilityState | 'unknown';
  readonly reasonCode: NimiRuntimeAgentAIConfigReadinessReasonCode | 'unknown';
  readonly probedAt: string | null;
  readonly binding: NimiRuntimeAgentAIConfigBinding | null;
  readonly blocksTextTurns: boolean;
  readonly editable: boolean;
  readonly summary: string;
}

export interface AgentCenterAutonomyState {
  readonly enabled: boolean | null;
  readonly mode: NimiRuntimeAgentAutonomyMode | null;
  readonly dailyTokenBudget: number | null;
  readonly maxTokensPerHook: number | null;
  readonly budgetExhausted: boolean | null;
  readonly controlsDisabled: boolean;
  readonly disabledReason: string | null;
}

export interface AgentCenterCognitionState {
  readonly lifecycleStatus: string | null;
  readonly executionState: string | null;
  readonly statusText: string | null;
  readonly currentEmotion: string | null;
  readonly memoryState: 'ready' | 'empty' | 'unavailable';
  readonly recentCanonicalMemories: readonly NimiRuntimeAgentCanonicalMemoryInspect[];
}

export interface AgentCenterAdvancedDiagnosticsState {
  readonly source: 'runtime-projection' | 'unavailable';
  readonly configRevision: number | null;
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
  readonly runtimeError: string | null;
}

export interface AgentCenterState {
  readonly runtimeStatus: AgentCenterRuntimeStatus;
  readonly statusTone: AgentCenterStatusTone;
  readonly baseTextReady: boolean;
  readonly baseTextDisabledReason: string | null;
  readonly configRevision: number | null;
  readonly capabilities: readonly AgentCenterCapabilityState[];
  readonly autonomy: AgentCenterAutonomyState;
  readonly cognition: AgentCenterCognitionState;
  readonly appearance: AgentCenterAppearanceProjection;
  readonly diagnostics: AgentCenterAdvancedDiagnosticsState;
  readonly sections: readonly AgentCenterSectionId[];
}

export interface AgentCenterStateInput extends AgentCenterRuntimeSnapshot {
  readonly appearance?: AgentCenterAppearanceProjection | null;
  readonly autonomyMutationAvailable?: boolean;
}

export interface AgentCenterProps {
  readonly state: AgentCenterState | AgentCenterStateInput;
  readonly activeSection?: AgentCenterSectionId;
  readonly defaultSection?: AgentCenterSectionId;
  readonly onSectionChange?: (section: AgentCenterSectionId) => void;
  readonly runtimeAdapter?: AgentCenterRuntimeAdapter | null;
  readonly appearanceAdapter?: AgentCenterAppearanceAdapter | null;
  readonly placementActions?: AgentCenterPlacementActions;
  readonly identity?: AgentCenterIdentityProjection | null;
  readonly chrome?: 'standalone' | 'embedded';
  readonly ariaLabel?: string;
}

export type AgentCenterAgentAIConfigIntents = NimiRuntimeAgentAIConfigIntents;
export type AgentCenterRuntimeAIConfigBinding = NimiRuntimeAgentAIConfigBinding;
