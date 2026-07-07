import type {
  NimiRuntimeAgentAutonomyConfigInput,
  NimiRuntimeAgentAutonomyMode,
  NimiRuntimeAgentAutonomySnapshot,
  NimiRuntimeAgentCanonicalMemoryInspect,
  NimiRuntimeAgentExecutionBinding,
  NimiRuntimeAgentExecutionConfigBindings,
  NimiRuntimeAgentExecutionConfigModule,
  NimiRuntimeAgentExecutionConfigSnapshot,
  NimiRuntimeAgentExecutionConfigUpsertInput,
  NimiRuntimeAgentExecutionReadinessCapabilityState,
  NimiRuntimeAgentExecutionReadinessReasonCode,
  NimiRuntimeAgentExecutionReadinessSnapshotProjection,
  NimiRuntimeAgentInspectSnapshot,
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentMemoryObservatorySnapshot,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';

export type AgentCenterCapabilityId =
  | 'text.generate'
  | 'image.generate'
  | 'audio.synthesize';

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
  readonly executionConfig: NimiRuntimeAgentExecutionConfigModule;
  readonly inspect?: NimiRuntimeAgentInspectSurface | null;
  loadSnapshot(input?: AgentCenterRuntimeLoadInput): Promise<AgentCenterRuntimeSnapshot>;
  upsertExecutionConfig?(
    input: NimiRuntimeAgentExecutionConfigUpsertInput,
  ): Promise<NimiRuntimeAgentExecutionConfigSnapshot>;
  setAutonomyConfig?(
    input: RuntimeLocalAgentIdentityInput & Omit<NimiRuntimeAgentAutonomyConfigInput, keyof RuntimeLocalAgentIdentityInput>,
  ): Promise<NimiRuntimeAgentAutonomySnapshot>;
}

export interface AgentCenterRuntimeLoadInput {
  readonly identity?: RuntimeLocalAgentIdentityInput;
  readonly subjectUserId?: string;
}

export interface AgentCenterRuntimeSnapshot {
  readonly executionConfig?: NimiRuntimeAgentExecutionConfigSnapshot | null;
  readonly readiness?: NimiRuntimeAgentExecutionReadinessSnapshotProjection | null;
  readonly inspect?: NimiRuntimeAgentInspectSnapshot | null;
  readonly memory?: NimiRuntimeAgentMemoryObservatorySnapshot | null;
  readonly runtimeError?: string | null;
}

export interface AgentCenterAppearanceProjection {
  readonly status: 'ready' | 'not_configured' | 'invalid' | 'loading';
  readonly backendKind?: string | null;
  readonly avatarAssetRef?: string | null;
  readonly backgroundRef?: string | null;
  readonly defaultVoiceReference?: string | null;
  readonly avatarAutoplay?: boolean;
  readonly disabledReason?: string | null;
}

export interface AgentCenterAppearanceAdapter {
  readonly load: () => Promise<AgentCenterAppearanceProjection>;
  readonly admitAsset?: (input: AgentCenterAppearanceAssetAdmissionInput) => Promise<AgentCenterAppearanceProjection>;
  readonly setAvatarAutoplay?: (enabled: boolean) => Promise<AgentCenterAppearanceProjection>;
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

export interface AgentCenterCapabilityState {
  readonly capability: AgentCenterCapabilityId;
  readonly label: string;
  readonly required: boolean;
  readonly readinessState: NimiRuntimeAgentExecutionReadinessCapabilityState | 'unknown';
  readonly reasonCode: NimiRuntimeAgentExecutionReadinessReasonCode | 'unknown';
  readonly probedAt: string | null;
  readonly binding: NimiRuntimeAgentExecutionBinding | null;
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
  readonly ariaLabel?: string;
}

export type AgentCenterExecutionConfigBindings = NimiRuntimeAgentExecutionConfigBindings;
