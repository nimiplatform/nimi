import type {
  NimiSharedLocalAgentAIConfigOptionsQuery,
  NimiSharedLocalAgentAIConfigOptionsResult,
  NimiSharedLocalAgentCapabilityParticipation,
  NimiSharedLocalAgentAIConfigOverwriteResult,
  NimiLocalAppAgentAutonomyMode,
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationBackendKind,
  NimiRuntimeAgentAutonomySnapshot,
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
  NimiJsonObject,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigEffectiveSelectionProjection,
} from '@nimiplatform/kit/features/model-config/headless';

/** Capability identities are runtime-projected and admitted by the canonical Kit catalog. */
export type AgentCenterCapabilityId = string;

export type AgentCenterSectionId =
  | 'overview'
  | 'ai-config'
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

export type AgentCenterHostScope =
  | 'account'
  | 'local-agent';

export type AgentCenterChromeCopy = Partial<{
  readonly title: string;
  readonly eyebrow: string;
  readonly closeLabel: string;
  readonly openRuntimeSettingsLabel: string;
  readonly launchAvatarLabel: string;
  readonly navLabel: string;
  readonly textConfiguredLabel: string;
  readonly avatarFallback: string;
  readonly projectionLoadFailed: string;
  readonly loadingLabel: string;
}>;

export type AgentCenterProgressCopy = Partial<{
  readonly configLabel: string;
}>;

export type AgentCenterOverviewCopy = Partial<{
  readonly readyTitle: string;
  readonly attentionTitle: string;
  readonly checklistTitle: string;
  readonly appearanceReadyDescription: string;
  readonly appearancePendingDescription: string;
  readonly capabilitiesConfiguredDescription: string;
  readonly capabilitiesNotConfiguredDescription: string;
  readonly behaviorReadyDescriptionPrefix: string;
  readonly behaviorReadyEnabledFallback: string;
  readonly behaviorOffDescription: string;
  readonly cognitionFallbackDescription: string;
  readonly readyPill: string;
  readonly configuredPill: string;
  readonly needsSetupPill: string;
  readonly enabledPill: string;
  readonly offPill: string;
  readonly projectedPill: string;
  readonly readOnlyPill: string;
  readonly sourceContextTitle: string;
  readonly sourceContextReadyDescription: string;
  readonly sourceContextBlockedDescription: string;
  readonly sourceContextTruncatedDescription: string;
  readonly sourceContextFailedDescription: string;
  readonly sourceContextUnknownDescription: string;
  readonly sourceContextReadyPill: string;
  readonly sourceContextBlockedPill: string;
  readonly sourceContextTruncatedPill: string;
  readonly sourceContextFailedPill: string;
  readonly sourceContextUnknownPill: string;
}>;

export type AgentCenterAdvancedCopy = Partial<{
  readonly title: string;
  readonly descriptionRuntimeProjection: string;
  readonly descriptionUnavailable: string;
  readonly lifecycleStatusLabel: string;
  readonly executionStateLabel: string;
  readonly statusTextLabel: string;
  readonly currentEmotionLabel: string;
  readonly sourceCapturedAtLabel: string;
  readonly runtimeTurnLabel: string;
  /** @deprecated Runtime stream is not part of Agent Center diagnostics. */
  readonly runtimeStreamLabel: string;
  readonly runtimeErrorLabel: string;
  readonly unavailableValue: string;
  readonly notProjectedValue: string;
  readonly noneValue: string;
  readonly sourceContextStatusLabel: string;
  readonly sourceCoverageLabel: string;
  readonly lorebookLabel: string;
  readonly contextLanesLabel: string;
  readonly contextBudgetLabel: string;
  readonly contextCapacityLabel: string;
  readonly contextCapacityAction: string;
  readonly contextTruncationLabel: string;
  readonly contextInputsLabel: string;
  readonly cognitionSourceLabel: string;
  readonly conversationSummaryLabel: string;
  readonly privateRecallLabel: string;
  readonly sourceContextReadyValue: string;
  readonly sourceContextBlockedValue: string;
  readonly sourceContextTruncatedValue: string;
  readonly sourceContextFailedValue: string;
  readonly sourceContextUnknownValue: string;
  readonly sourceCoverageFormat: string;
  readonly lorebookFormat: string;
  readonly contextLanesFormat: string;
  readonly contextBudgetFormat: string;
  readonly contextCapacityFormat: string;
  readonly contextTruncationFormat: string;
  readonly contextInputsFormat: string;
  readonly cognitionSourceFormat: string;
  readonly conversationSummaryFormat: string;
  readonly privateRecallFormat: string;
}>;

export interface AgentCenterI18n {
  /** BCP 47 language tag used to select the shipped Kit catalog before English fallback. */
  readonly language?: string;
  /** Optional host catalog probe; false preserves the shipped Kit fallback. */
  readonly exists?: (key: string) => boolean;
  readonly t: (
    key: string,
    values?: Readonly<Record<string, string | number | boolean | null | undefined>>,
  ) => string;
}

export type AgentCenterCopy = Partial<{
  readonly sectionLabels: Partial<Record<AgentCenterSectionId, string>>;
  readonly capabilityLabels: Partial<Record<AgentCenterCapabilityId, string>>;
  readonly chrome: AgentCenterChromeCopy;
  readonly progress: AgentCenterProgressCopy;
  readonly overview: AgentCenterOverviewCopy;
  readonly advanced: AgentCenterAdvancedCopy;
}>;

export type AgentCenterRuntimeStatus =
  | 'ready'
  | 'disabled'
  | 'loading'
  | 'failed';

export type AgentCenterAIConfigMutationDisabledReason =
  | 'agent-ai-config-snapshot-unavailable'
  | 'action-unavailable';

export type AgentCenterProductAction =
  | 'getSharedAIConfig'
  | 'overwriteSharedAIConfig'
  | 'readAutonomy'
  | 'updateAutonomy'
  | 'inspectMemory'
  | 'correctMemory'
  | 'forgetMemory'
  | 'switchMemory'
  | 'deleteAllMemory'
  | 'replaceAppearance'
  | 'restorePreviousAppearance';

export type AgentCenterActionUnavailableReason =
  | 'runtime-offline'
  | 'owner-rejected'
  | 'selection-required'
  | 'unsupported'
  | 'operation-unavailable'
  | 'unknown';

export type AgentCenterNextStepAction =
  | 'openRuntimeSettings'
  | 'retry';

export type AgentCenterActionAvailability =
  | { readonly state: 'available'; readonly reason: null; readonly nextStep: null }
  | {
      readonly state: 'unavailable';
      readonly reason: AgentCenterActionUnavailableReason;
      readonly nextStep: AgentCenterNextStepAction;
    };

export type AgentCenterActionAvailabilityProjection = Readonly<
  Record<AgentCenterProductAction, AgentCenterActionAvailability>
>;

export interface AgentCenterAutonomyProjection extends NimiRuntimeAgentAutonomySnapshot {
  readonly revision: string | null;
}

export interface AgentCenterAutonomyMutationInput {
  readonly expectedRevision: string;
  readonly enabled?: boolean;
  readonly mode: NimiLocalAppAgentAutonomyMode;
  readonly dailyTokenBudget: number;
  readonly maxTokensPerHook: number;
}

export interface AgentCenterAIConfigMutation {
  readonly expectedRevision: string;
  readonly capabilities: readonly NimiCapabilityAIConfigIntent[];
  readonly displayProvenance?: NimiJsonObject;
}

export type AgentCenterAutonomyMutation = AgentCenterAutonomyMutationInput;

export interface AgentCenterPresentationIntent {
  readonly backendKind?: NimiLocalAppAgentPresentationBackendKind | null;
  readonly avatarAssetReference?: string | null;
  readonly defaultVoiceReference?: string | null;
  readonly avatarAutoplay?: boolean;
  readonly backgroundAssetReference?: string | null;
}

type AgentCenterPresentationMaterialBase = Readonly<{
  readonly fileName: string;
  readonly content: Uint8Array;
  readonly sha256: string;
}>;

export type AgentCenterPresentationAssetMaterial =
  | (AgentCenterPresentationMaterialBase & {
    readonly role: 'avatar' | 'background';
    readonly mediaType: string;
  })
  | (AgentCenterPresentationMaterialBase & {
    readonly role: 'resource-pack';
    readonly mediaType: 'application/vnd.nimi.resource-pack+zip';
  });

export interface AgentCenterPresentationCommitInput {
  readonly expectedRevision: string;
  readonly intent: AgentCenterPresentationIntent;
  readonly importedAssets: readonly AgentCenterPresentationAssetMaterial[];
}

export interface AgentCenterAIConfigIntentProjection {
  readonly capability: string;
  readonly route: 'local' | 'cloud';
  readonly requiredFeatures: readonly string[];
}

export interface AgentCenterSharedAIConfigProjection {
  readonly aiConfig: NimiCapabilityAIConfig;
  readonly revision: string;
  readonly intents: readonly AgentCenterAIConfigIntentProjection[];
}

export interface AgentCenterRuntimeSnapshot {
  /** Undefined means the read is unavailable; null is Runtime-confirmed canonical absence. */
  readonly sharedAIConfig?: AgentCenterSharedAIConfigProjection | null;
  /** Runtime effective facts for the committed shared AIConfig; never a second configuration truth. */
  readonly effectiveSelections?: readonly ModelConfigEffectiveSelectionProjection[];
  readonly participation?: readonly NimiSharedLocalAgentCapabilityParticipation[];
  readonly autonomy?: AgentCenterAutonomyProjection | null;
  /** Canonical covered-App Manager snapshot; safe owner state only. */
  readonly manager?: AgentCenterAppManagerSnapshot | null;
  readonly cognitionMemory?: AgentCenterMemoryProjection | null;
  readonly runtimeError?: string | null;
}

export type AgentCenterSourceContextStatus =
  | 'ready'
  | 'blocked'
  | 'truncated'
  | 'failed'
  | 'unknown';

export type AgentCenterAppManagerSnapshot = Awaited<
  ReturnType<NimiLocalAppAgentConfigureClient['manager']['snapshot']>
>;

export type AgentCenterAppManagerSource = NonNullable<AgentCenterAppManagerSnapshot['source']>;

export type AgentCenterAppManagerContext = NonNullable<AgentCenterAppManagerSnapshot['context']>;

export type AgentCenterContextLaneId = AgentCenterAppManagerContext['lanes'][number]['laneId'];

export interface AgentCenterSourceCoverageSummary {
  readonly totalSections: number;
  readonly completeSections: number;
  readonly omittedSections: number;
  readonly requiredItemCount: number;
  readonly resolvedItemCount: number;
  readonly omittedItemCount: number;
}

export interface AgentCenterSourceProjectionSummary {
  readonly ready: boolean;
  readonly state: AgentCenterAppManagerSource['state'];
  readonly reasonCode: AgentCenterAppManagerSource['reasonCode'];
  readonly capturedAt: string | null;
  readonly coverageSections: AgentCenterAppManagerSource['coverageSections'];
  readonly coverage: AgentCenterSourceCoverageSummary;
  readonly lorebookReady: boolean;
  readonly lorebookItemCount: number;
  readonly lorebookEstimatedTokens: string;
}

export interface AgentCenterContextLaneSummary {
  readonly laneId: AgentCenterContextLaneId;
  readonly state: AgentCenterAppManagerContext['lanes'][number]['state'];
  readonly includedItemCount: number;
  readonly omittedItemCount: number;
  readonly truncatedItemCount: number;
  readonly allocatedTokens: string;
  readonly usedTokens: string;
}

export interface AgentCenterTurnContextProjectionSummary {
  readonly ready: boolean;
  readonly state: AgentCenterAppManagerContext['state'];
  readonly reasonCode: AgentCenterAppManagerContext['reasonCode'];
  readonly lanes: readonly AgentCenterContextLaneSummary[];
  readonly budget: {
    readonly inputBudgetTokens: string;
    readonly usedTokens: string;
    readonly requiredInputTokens: string;
    readonly requiredContextWindowTokens: string;
  };
  readonly truncation: AgentCenterAppManagerContext['truncation'];
  readonly transcriptTurnCount: number;
  readonly memoryItemCount: number;
  readonly mediaCount: number;
  readonly toolCount: number;
  readonly sourceAdapterStatus: AgentCenterAppManagerContext['sourceAdapterStatus'];
  readonly sourceSelectionStatus: AgentCenterAppManagerContext['sourceSelectionStatus'];
  readonly conversationSummaryStatus: AgentCenterAppManagerContext['conversationSummaryStatus'];
  readonly privateRecallCount: number;
}

export interface AgentCenterSourceContextProjection {
  readonly status: AgentCenterSourceContextStatus;
  readonly source: AgentCenterSourceProjectionSummary | null;
  readonly context: AgentCenterTurnContextProjectionSummary | null;
}

export type AgentCenterAppearanceDisabledReasonCode =
  | 'avatar-not-configured'
  | 'scope-required'
  | 'bridge-unavailable'
  | 'configuration-unavailable'
  | 'validation-unavailable';

export type AgentCenterResourcePackSelectionProjection = Readonly<{
  assetRef: string;
  targetId: 'zhiyu-experience-surface';
  targetVersion: 1;
}>;

export type AgentCenterResourcePackPlacementFailureReason =
  | 'target-app-unavailable'
  | 'operation-unavailable'
  | 'launch-failed'
  | 'destination-not-ready'
  | 'destination-session-failed'
  | 'agent-resolution-failed';

export type AgentCenterResourcePackPlacementResult = Readonly<
  | { status: 'ready'; reasonCode: 'zhiyu-resource-pack-placement-ready' }
  | {
      status: 'unavailable' | 'failed';
      reasonCode: AgentCenterResourcePackPlacementFailureReason;
      actionHint: 'start_zhiyu_and_retry' | 'retry_zhiyu_resource_pack_placement';
    }
>;

export type AgentCenterResourcePackPlacementAvailability = Readonly<
  | { state: 'available'; reasonCode: null; actionHint: null }
  | {
      state: 'unavailable';
      reasonCode: 'selection-required' | 'operation-unavailable';
      actionHint: 'open_current_conversation' | 'retry_zhiyu_resource_pack_placement';
    }
>;

export interface AgentCenterResourcePackPlacementAdapter {
  readonly availability: AgentCenterResourcePackPlacementAvailability;
  open(): Promise<AgentCenterResourcePackPlacementResult>;
}

export type AgentCenterResourcePackTargetPhase =
  | 'default'
  | 'selected'
  | 'preview'
  | 'apply-in-flight'
  | 'render-pending'
  | 'fallback';

export type AgentCenterResourcePackPendingTruth =
  | 'selection-unchanged-candidate-not-applied'
  | 'selection-saved-not-effective'
  | 'apply-outcome-unknown'
  | 'clear-outcome-unknown'
  | null;

export type AgentCenterResourcePackTargetSnapshot = Readonly<{
  phase: AgentCenterResourcePackTargetPhase;
  reviewFileName: string | null;
  pendingTruth: AgentCenterResourcePackPendingTruth;
  effectiveResourceRef: string | null;
  mismatchReason: string | null;
  error: string | null;
}>;

export type AgentCenterResourcePackApplyMaterial = Readonly<{
  agentHandle: NimiLocalAppAgentHandle;
  expectedRevision: string;
  archiveBytes: Uint8Array;
}>;

/** Specific Zhiyu target renderer seam; it is not an arbitrary AgentCenter extension slot. */
export interface AgentCenterResourcePackTargetController {
  getSnapshot(): AgentCenterResourcePackTargetSnapshot;
  subscribe(listener: () => void): () => void;
  resetAgent(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string | null;
  }): void;
  beginPreview(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly expectedRevision: string;
    readonly fileName: string;
    readonly archiveBytes: Uint8Array;
  }): Promise<void>;
  cancelPreview(): void;
  prepareApply(): AgentCenterResourcePackApplyMaterial;
  applyFailed(message: string): void;
  mutationOutcomeUnknown(kind: 'apply' | 'clear', message: string): void;
  applyCommitted(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string;
  }): void;
  renderSelected(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string;
    readonly archiveBytes: Uint8Array;
  }): Promise<boolean>;
  selectedRenderFailed(message: string): void;
  clearCommitted(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
  }): void;
  dispose(): void;
}

export interface AgentCenterAppearanceProjection {
  readonly status: 'ready' | 'not_configured' | 'invalid' | 'loading';
  readonly presentationRevision?: string | null;
  readonly backendKind?: string | null;
  readonly avatarAssetRef?: string | null;
  readonly expressionProfileRef?: string | null;
  readonly idlePreset?: string | null;
  readonly interactionPolicyRef?: string | null;
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
  readonly renderMaterialRef?: string | null;
  readonly renderState?: 'ready' | 'failed' | 'loading' | 'unavailable' | null;
  readonly renderTier?: 'avatar_preview_service' | string | null;
  readonly renderImageRef?: string | null;
  readonly renderVisiblePixels?: number | null;
  readonly renderFailureReason?: string | null;
  readonly renderUnavailableReasonCode?: 'preview-not-running' | 'renderer-unavailable' | null;
  readonly renderWarnings?: readonly string[];
  readonly resourcePackSelection?: AgentCenterResourcePackSelectionProjection | null;
  readonly resourcePackTarget?: AgentCenterResourcePackTargetSnapshot | null;
  readonly resourcePackMutationPending?: 'apply' | 'clear' | null;
  readonly resourcePackPlacementAvailability?: AgentCenterResourcePackPlacementAvailability;
  readonly previousSelection?: AgentCenterPresentationIntent | null;
  readonly defaultVoiceReference?: string | null;
  readonly voiceCatalog?: AgentCenterVoiceCatalogProjection;
  readonly avatarAutoplay?: boolean;
  readonly avatarImportDisabled?: boolean;
  readonly backgroundImportDisabled?: boolean;
  readonly avatarConfigPending?: boolean;
  readonly avatarImportPending?: boolean;
  readonly backgroundImportPending?: boolean;
  readonly avatarImportError?: string | null;
  readonly developerModeEnabled?: boolean;
  /** Closed category used for behavior; disabledReason is presentation copy only. */
  readonly disabledReasonCode?: AgentCenterAppearanceDisabledReasonCode | null;
  readonly disabledReason?: string | null;
}

export interface AgentCenterVoiceCatalogOption {
  readonly reference: `preset_voice_id:${string}` | `voice_asset_id:${string}`;
  readonly kind: 'preset_voice_id' | 'voice_asset_id';
  readonly name: string;
  readonly supportedLangs: readonly string[];
}

export type AgentCenterVoiceCatalogSourceProjection =
  | {
      readonly state: 'ready';
      readonly reason: null;
      readonly message: null;
      readonly truncated: boolean;
    }
  | {
      readonly state: 'unavailable';
      readonly reason: AgentCenterActionUnavailableReason;
      readonly message: string;
      readonly truncated: false;
    };

type AgentCenterVoiceCatalogSources = Readonly<{
  preset: AgentCenterVoiceCatalogSourceProjection;
  custom: AgentCenterVoiceCatalogSourceProjection;
}>;

export type AgentCenterVoiceCatalogProjection =
  | {
      readonly state: 'ready';
      readonly sourceLabel: string;
      readonly options: readonly AgentCenterVoiceCatalogOption[];
      readonly truncated: boolean;
      readonly message: string | null;
      readonly sources: AgentCenterVoiceCatalogSources;
    }
  | {
      readonly state: 'unavailable';
      readonly sourceLabel: null;
      readonly options: readonly [];
      readonly truncated: false;
      readonly message: string;
      readonly sources: AgentCenterVoiceCatalogSources;
    };

export interface AgentCenterAppearanceAdapter {
  readonly load: () => Promise<AgentCenterAppearanceProjection>;
  readonly replaceAppearance?: (
    input: AgentCenterPresentationCommitInput,
  ) => Promise<AgentCenterAppearanceProjection>;
  readonly replaceAvatar?: (kind: 'live2d' | 'vrm') => Promise<AgentCenterAppearanceProjection>;
  readonly importBackground?: () => Promise<AgentCenterAppearanceProjection>;
  readonly setDefaultVoice?: (reference: string) => Promise<AgentCenterAppearanceProjection>;
  readonly setAvatarAutoplay?: (enabled: boolean) => Promise<AgentCenterAppearanceProjection>;
  readonly restorePreviousAppearance?: () => Promise<AgentCenterAppearanceProjection>;
}

/**
 * Host-native mechanics are limited to selection/custody and committed-view
 * preview evidence. They receive no Agent handle or raw owner identity and do
 * not commit Runtime product state.
 */
export interface AgentCenterHostAppearanceSelection {
  readonly intent: AgentCenterPresentationIntent;
  readonly importedAssets: readonly AgentCenterPresentationAssetMaterial[];
}

export type AgentCenterHostResourcePackSelection = AgentCenterPresentationMaterialBase & {
  readonly role: 'resource-pack';
  readonly mediaType: 'application/vnd.nimi.resource-pack+zip';
};

export interface AgentCenterHostCommittedPreviewInput {
  readonly backendKind: 'live2d' | 'vrm';
  readonly avatarAssetRef: string;
  readonly presentationRevision: string;
}

export type AgentCenterHostCommittedPreviewEvidence =
  | {
      readonly state: 'ready';
      readonly tier: 'avatar_preview_service';
      readonly previewImageRef: string;
      readonly visiblePixels: number;
      readonly nonPlaceholder: true;
      readonly warnings: readonly string[];
    }
  | {
      readonly state: 'failed' | 'unavailable';
      readonly tier: 'avatar_preview_service';
      readonly previewImageRef: null;
      readonly visiblePixels: null;
      readonly nonPlaceholder: false;
      readonly reason: string;
      readonly warnings: readonly string[];
    };

export interface AgentCenterHostMechanics {
  readonly selectAvatar?: (kind: 'live2d' | 'vrm') => Promise<AgentCenterHostAppearanceSelection>;
  readonly selectBackground?: () => Promise<AgentCenterHostAppearanceSelection>;
  readonly selectResourcePack?: () => Promise<AgentCenterHostResourcePackSelection | null>;
  readonly resolveCommittedPreview?: (
    input: AgentCenterHostCommittedPreviewInput,
  ) => Promise<AgentCenterHostCommittedPreviewEvidence>;
}

export type AgentCenterBehaviorCopy = Partial<{
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly enableTitle: string;
  readonly enableDescription: string;
  readonly enabledStatus: string;
  readonly disabledStatus: string;
  readonly modeTitle: string;
  readonly quietTitle: string;
  readonly quietDescription: string;
  readonly occasionalTitle: string;
  readonly occasionalDescription: string;
  readonly dailyTitle: string;
  readonly dailyDescription: string;
  readonly activeTitle: string;
  readonly activeDescription: string;
  readonly budgetTitle: string;
  readonly budgetDescription: string;
  readonly todayUsedLabel: string;
  readonly dailyLimitLabel: string;
  readonly singleLimitLabel: string;
  readonly reachedLimitLabel: string;
  readonly reachedLimitAction: string;
  readonly adjustLimitLabel: string;
  readonly applyLimitLabel: string;
  readonly tokensUnit: string;
  readonly approxPrefix: string;
  readonly savingLabel: string;
  readonly savedLabel: string;
  readonly unavailableLabel: string;
}>;

export interface AgentCenterAppearanceAssetAdmissionInput {
  readonly kind: 'avatar' | 'background' | 'calibration-reference';
  readonly localAssetRef: string;
}

export interface AgentCenterPlacementActions {
  readonly close?: () => void;
  readonly openRuntimeSettings?: () => void;
  readonly openMachineLoadout?: (capabilityContract: string) => void;
  readonly launchAvatar?: () => void;
}

export interface AgentCenterIdentityProjection {
  readonly displayName: string;
  readonly avatarUrl?: string | null;
  readonly avatarFallback?: string | null;
  readonly badgeLabel?: string | null;
}

export type { NimiLocalAppAgentHandle };

export interface AgentCenterCapabilityState {
  readonly capability: AgentCenterCapabilityId;
  readonly label: string;
  readonly required: boolean;
  readonly configurationState: 'configured' | 'not_configured' | 'unavailable' | 'failed' | 'unknown';
  readonly intent: AgentCenterAIConfigIntentProjection | null;
  readonly editable: boolean;
  readonly summary: string;
}

export interface AgentCenterAutonomyState {
  readonly revision: string | null;
  readonly enabled: boolean | null;
  readonly mode: NimiLocalAppAgentAutonomyMode | null;
  readonly usedTokensInWindow: number | null;
  readonly dailyTokenBudget: number | null;
  readonly maxTokensPerHook: number | null;
  readonly windowStartedAt: string | null;
  readonly suspendedUntil: string | null;
  readonly budgetExhausted: boolean | null;
  readonly controlsDisabled: boolean;
  readonly disabledReason: string | null;
}

export interface AgentCenterCognitionState {
  readonly lifecycleStatus: string | null;
  readonly executionState: string | null;
  readonly statusText: string | null;
  readonly currentEmotion: string | null;
  readonly memoryState: 'unconfigured' | 'building' | 'ready' | 'empty' | 'unavailable' | 'failed';
  readonly recentCanonicalMemoryCount: number;
  readonly memory: AgentCenterMemoryProjection | null;
}

export type AgentCenterMemoryOutcome =
  | 'unconfigured'
  | 'building'
  | 'ready'
  | 'no_hits'
  | 'unavailable'
  | 'failed'
  | 'invalid'
  | 'pending'
  | 'committed'
  | 'conflict'
  | 'forgotten'
  | 'deleted'
  | 'no_effect'
  | 'admitted'
  | 'rejected';

export interface AgentCenterMemoryItem {
  readonly memoryId: string;
  readonly content: string;
  readonly epistemicStatus: 'explicit' | 'inferred' | 'consolidated';
  readonly lifecycle: 'current' | 'superseded' | 'conflicted';
  readonly occurredAt: string;
  readonly updatedAt: string;
  readonly sourceExplanation: string;
}

export interface AgentCenterMemoryProjection {
  readonly outcome: AgentCenterMemoryOutcome;
  readonly enabled: boolean;
  readonly adoptionRequired: boolean;
  readonly items: readonly AgentCenterMemoryItem[];
  readonly currentCount: number;
  readonly supersededCount: number;
  readonly forgottenCount: number;
  readonly nextPageToken: string | null;
}

export interface AgentCenterMemoryMutationResult {
  readonly outcome: AgentCenterMemoryOutcome;
  readonly affectedMemoryIds: readonly string[];
  readonly projection: AgentCenterMemoryProjection;
}

export interface AgentCenterAdvancedDiagnosticsState {
  readonly source: 'runtime-projection' | 'unavailable';
  readonly runtimeError: string | null;
}

export interface AgentCenterState {
  readonly runtimeStatus: AgentCenterRuntimeStatus;
  readonly statusTone: AgentCenterStatusTone;
  readonly baseTextConfigured: boolean;
  readonly sharedAIConfig: AgentCenterSharedAIConfigProjection | null;
  /** Undefined means the current Manager Session cannot observe Runtime effective facts. */
  readonly effectiveSelections?: readonly ModelConfigEffectiveSelectionProjection[];
  readonly participation: readonly NimiSharedLocalAgentCapabilityParticipation[];
  readonly baseTextConfigurationDetail: string | null;
  readonly autonomyRevision: string | null;
  readonly presentationRevision: string | null;
  readonly agentAIConfigMutationDisabledReason: AgentCenterAIConfigMutationDisabledReason | null;
  readonly capabilities: readonly AgentCenterCapabilityState[];
  readonly autonomy: AgentCenterAutonomyState;
  readonly cognition: AgentCenterCognitionState;
  readonly appearance: AgentCenterAppearanceProjection;
  readonly diagnostics: AgentCenterAdvancedDiagnosticsState;
  readonly sourceContext: AgentCenterSourceContextProjection;
  readonly sections: readonly AgentCenterSectionId[];
}

export interface AgentCenterStateInput extends AgentCenterRuntimeSnapshot {
  readonly appearance?: AgentCenterAppearanceProjection | null;
}

export type AgentCenterStorePhase = 'loading' | 'ready' | 'degraded';

export interface AgentCenterSnapshot {
  readonly phase: AgentCenterStorePhase;
  readonly state: AgentCenterState;
  readonly availability: AgentCenterActionAvailabilityProjection;
  readonly error: string | null;
}

declare const AGENT_CENTER_SESSION: unique symbol;

export interface AgentCenterSession {
  readonly [AGENT_CENTER_SESSION]: true;
  getSnapshot(): AgentCenterSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** Permanently fences this session after account/session/handle replacement. */
  invalidate(): void;
  /** Alias for placement teardown. A disposed session cannot be reused. */
  dispose(): void;
  overwriteSharedAIConfig(input: AgentCenterAIConfigMutation): Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
  listSharedAIConfigOptions(input: NimiSharedLocalAgentAIConfigOptionsQuery): Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
  updateAutonomy(input: AgentCenterAutonomyMutation): Promise<void>;
  correctMemory(input: { readonly memoryId: string; readonly correctedContent: string }): Promise<AgentCenterMemoryMutationResult>;
  forgetMemory(input: { readonly memoryIds: readonly string[]; readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult>;
  setMemoryEnabled(enabled: boolean): Promise<AgentCenterMemoryMutationResult>;
  deleteAllMemory(input: { readonly confirmed: true }): Promise<AgentCenterMemoryMutationResult>;
  loadMoreMemory(): Promise<AgentCenterMemoryProjection>;
  replaceAppearance(input: AgentCenterPresentationCommitInput): Promise<void>;
  restorePreviousAppearance(): Promise<void>;
  readonly appearance: Readonly<{
    replaceAvatar?: (kind: 'live2d' | 'vrm') => Promise<void>;
    importBackground?: () => Promise<void>;
    setDefaultVoice?: (reference: string) => Promise<void>;
    setAvatarAutoplay?: (enabled: boolean) => Promise<void>;
    selectResourcePack?: () => Promise<void>;
    cancelResourcePackPreview?: () => void;
    applyResourcePack?: () => Promise<void>;
    openResourcePackInZhiyu?: () => Promise<void>;
    clearResourcePack: () => Promise<void>;
    retryResourcePack?: () => Promise<void>;
  }>;
}

export interface AgentCenterProps {
  readonly session: AgentCenterSession;
  readonly activeSection?: AgentCenterSectionId;
  readonly defaultSection?: AgentCenterSectionId;
  readonly onSectionChange?: (section: AgentCenterSectionId) => void;
  readonly i18n?: AgentCenterI18n;
  readonly placementActions?: AgentCenterPlacementActions;
  readonly identity?: AgentCenterIdentityProjection | null;
  readonly chrome?: 'standalone' | 'embedded';
}

export type AgentCenterAIConfigRouteIntent = AgentCenterAIConfigIntentProjection;
