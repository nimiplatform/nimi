import type {
  NimiSharedLocalAgentAIConfigOptionsQuery,
  NimiSharedLocalAgentAIConfigOptionsResult,
  NimiAIConfigSnapshot,
  NimiSharedLocalAgentCapabilityParticipation,
  NimiSharedLocalAgentAIConfigSnapshot,
  NimiSharedLocalAgentAIConfigOverwriteResult,
  NimiLocalAppAgentAutonomyMode,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentPresentationBackendKind,
  NimiRuntimeAgentAutonomySnapshot,
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
  NimiJsonObject,
  NimiRuntimeAgentInspectSnapshot,
  NimiRuntimeAgentInspectSurface,
  NimiRuntimeAgentMemoryObservatorySnapshot,
  NimiRuntimeAgentPresentationProfileProjection,
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentSourceKind,
  NimiRuntimeAgentTurnContextSummary,
  NimiRuntimeAgentTurnContextLaneId,
  NimiRuntimeAgentTurnContextLaneSummary,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import type { AgentCenterAvatarPreviewServiceResult } from '@nimiplatform/kit/features/avatar/headless';
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
  readonly runtimeTurnLabel: string;
  /** @deprecated Runtime stream is not part of Agent Center diagnostics. */
  readonly runtimeStreamLabel: string;
  readonly runtimeErrorLabel: string;
  readonly unavailableValue: string;
  readonly notProjectedValue: string;
  readonly noneValue: string;
  readonly sourceContextStatusLabel: string;
  readonly sourceKindLabel: string;
  readonly sourceReferenceLabel: string;
  readonly sourceSchemaLabel: string;
  readonly sourceHashLabel: string;
  readonly sourceSnapshotLabel: string;
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
  readonly routeDigestLabel: string;
  readonly catalogDigestLabel: string;
  readonly sourceContextReadyValue: string;
  readonly sourceContextBlockedValue: string;
  readonly sourceContextTruncatedValue: string;
  readonly sourceContextFailedValue: string;
  readonly sourceContextUnknownValue: string;
  readonly worldCharacterValue: string;
  readonly personaCharacterValue: string;
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
  | 'readMemorySummary'
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

export interface AgentCenterPresentationAssetMaterial {
  readonly role: 'avatar' | 'background';
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
}

export interface AgentCenterPresentationCommitInput {
  readonly expectedRevision: string;
  readonly intent: AgentCenterPresentationIntent;
  readonly importedAssets: readonly AgentCenterPresentationAssetMaterial[];
}

export interface AgentCenterRuntimeLoadInput {
  readonly identity?: RuntimeLocalAgentIdentityInput;
  readonly subjectUserId?: string;
  readonly conversationAnchorId?: string;
}

export interface AgentCenterTurnContextLoadInput extends RuntimeLocalAgentIdentityInput {
  readonly conversationAnchorId?: string;
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
  readonly inspect?: NimiRuntimeAgentInspectSnapshot | null;
  readonly memory?: NimiRuntimeAgentMemoryObservatorySnapshot | null;
  readonly sourceContextStatus?: NimiRuntimeAgentSourceContextStatus | null;
  readonly turnContextSummary?: NimiRuntimeAgentTurnContextSummary | null;
  readonly runtimeError?: string | null;
}

export type AgentCenterSourceContextStatus =
  | 'ready'
  | 'blocked'
  | 'truncated'
  | 'failed'
  | 'unknown';

export type AgentCenterSourceKind = NimiRuntimeAgentSourceKind;

export type AgentCenterContextLaneId = NimiRuntimeAgentTurnContextLaneId;

export interface AgentCenterSourceCoverageSummary {
  readonly totalSections: number;
  readonly completeSections: number;
  readonly omittedSections: number;
  readonly requiredItemCount: number;
  readonly resolvedItemCount: number;
  readonly omittedItemCount: number;
}

export interface AgentCenterSourceProjectionSummary {
  readonly kind: AgentCenterSourceKind;
  readonly schemaVersion: 'v2';
  readonly snapshotSchemaVersion: 'v3';
  readonly sourceSchemaVersion: 'realm.world-character-core/v1' | 'realm.persona-character-core/v1';
  readonly worldId: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly snapshotHash: string;
  readonly worldContentHash: string;
  readonly materializationContextHash: string;
  readonly capturedAt: string;
  readonly coverage: AgentCenterSourceCoverageSummary;
  readonly lorebookReady: true;
  readonly lorebookItemCount: number;
  readonly lorebookEstimatedTokens: string;
}

export interface AgentCenterContextLaneSummary {
  readonly laneId: AgentCenterContextLaneId;
  readonly state: NimiRuntimeAgentTurnContextLaneSummary['state'];
  readonly includedItemCount: number;
  readonly omittedItemCount: number;
  readonly truncatedItemCount: number;
  readonly allocatedTokens: string;
  readonly usedTokens: string;
}

export interface AgentCenterTurnContextProjectionSummary {
  readonly schemaVersion: 'v2';
  readonly manifestSchemaVersion: 'v1';
  readonly compilerSchemaVersion: 'v1';
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly manifestInstanceHash: string | null;
  readonly contextContentHash: string | null;
  readonly promptHash: string | null;
  readonly lanes: readonly AgentCenterContextLaneSummary[];
  readonly budget: {
    readonly contextWindowTokens: string;
    readonly reservedReasoningTokens: string;
    readonly inputBudgetTokens: string;
    readonly usedTokens: string;
    readonly requiredInputTokens: string;
    readonly requiredContextWindowTokens: string;
  };
  readonly truncation: {
    readonly omittedItemCount: number;
    readonly truncatedItemCount: number;
  };
  readonly transcriptTurnCount: number;
  readonly memoryItemCount: number;
  readonly mediaCount: number;
  readonly toolCount: number;
  readonly routeDigest: string;
  readonly catalogRevisionDigest: string;
  readonly sourceCognition: Exclude<NimiRuntimeAgentTurnContextSummary['sourceCognition'], null>;
  readonly conversationSummary: Exclude<NimiRuntimeAgentTurnContextSummary['conversationSummary'], null>;
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

export interface AgentCenterAppearanceProjection {
  readonly status: 'ready' | 'not_configured' | 'invalid' | 'loading';
  readonly presentationRevision?: string | null;
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
  readonly resourceCleanupError?: string | null;
  readonly renderMaterialRef?: string | null;
  readonly renderState?: 'ready' | 'failed' | 'loading' | 'unavailable' | null;
  readonly renderTier?: 'avatar_preview_service' | string | null;
  readonly renderImageRef?: string | null;
  readonly renderVisiblePixels?: number | null;
  readonly renderFailureReason?: string | null;
  readonly renderUnavailableReasonCode?: 'preview-not-running' | 'renderer-unavailable' | null;
  readonly renderWarnings?: readonly string[];
  readonly previousSelection?: AgentCenterPresentationIntent | null;
  readonly defaultVoiceReference?: string | null;
  readonly voiceCatalog?: AgentCenterVoiceCatalogProjection;
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

export type AgentCenterVoiceCatalogProjection =
  | {
      readonly state: 'ready';
      readonly sourceLabel: string;
      readonly options: readonly AgentCenterVoiceCatalogOption[];
      readonly truncated: boolean;
      readonly message: null;
    }
  | {
      readonly state: 'unavailable';
      readonly sourceLabel: null;
      readonly options: readonly [];
      readonly truncated: false;
      readonly message: string;
    };

export interface AgentCenterAppearanceAdapter {
  readonly load: () => Promise<AgentCenterAppearanceProjection>;
  readonly replaceAppearance?: (
    input: AgentCenterPresentationCommitInput,
  ) => Promise<AgentCenterAppearanceProjection>;
  readonly replaceAvatar?: (kind: 'live2d' | 'vrm') => Promise<AgentCenterAppearanceProjection>;
  readonly linkLive2dAdapterManifest?: () => Promise<AgentCenterAppearanceProjection>;
  readonly clearAvatarAsset?: () => Promise<AgentCenterAppearanceProjection>;
  readonly importBackground?: () => Promise<AgentCenterAppearanceProjection>;
  readonly clearBackground?: () => Promise<AgentCenterAppearanceProjection>;
  readonly removeAgentResources?: () => Promise<AgentCenterAppearanceProjection>;
  readonly cleanupGeneratedVoiceArtifacts?: () => Promise<AgentCenterAppearanceProjection>;
  readonly setDefaultVoice?: (reference: string) => Promise<AgentCenterAppearanceProjection>;
  readonly setAvatarAutoplay?: (enabled: boolean) => Promise<AgentCenterAppearanceProjection>;
  readonly restorePreviousAppearance?: () => Promise<AgentCenterAppearanceProjection>;
}

export interface AgentCenterAvatarPreviewResolveInput {
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly accountId: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly avatarAssetRef: string;
  readonly previewMaterialRef: string;
  readonly backendCapabilityProfileRef?: string | null;
}

type AgentCenterAvatarPreviewServiceReadyResult = Extract<
  AgentCenterAvatarPreviewServiceResult,
  { readonly state: 'ready' }
>;
type AgentCenterAvatarPreviewServiceNonReadyResult = Exclude<
  AgentCenterAvatarPreviewServiceResult,
  { readonly state: 'ready' }
>;

export type AgentCenterAvatarPreviewAdapterResult =
  | Omit<AgentCenterAvatarPreviewServiceReadyResult, 'backendKind'> & {
      readonly backendKind: 'live2d' | 'vrm';
      readonly previewMaterialRef: string;
    }
  | Omit<AgentCenterAvatarPreviewServiceNonReadyResult, 'backendKind'> & {
      readonly backendKind?: 'live2d' | 'vrm' | null;
      readonly previewMaterialRef?: string | null;
      readonly previewImageRef?: string | null;
      readonly visiblePixels?: number | null;
    };

export interface AgentCenterAvatarPreviewAdapter {
  readonly resolvePreview: (
    input: AgentCenterAvatarPreviewResolveInput,
  ) => Promise<AgentCenterAvatarPreviewAdapterResult>;
}

export interface AgentCenterRuntimePresentationProfilePatch {
  readonly backendKind?: string | null;
  readonly avatarAssetRef?: string | null;
  readonly expressionProfileRef?: string | null;
  readonly idlePreset?: string | null;
  readonly interactionPolicyRef?: string | null;
  readonly defaultVoiceReference?: string | null;
  readonly avatarAutoplay?: boolean;
  readonly backgroundAssetRef?: string | null;
}

export interface AgentCenterRuntimePresentationProfileSurface {
  readonly setPresentationProfile: (
    input: RuntimeLocalAgentIdentityInput,
    profile: AgentCenterRuntimePresentationProfilePatch | null,
    expectedRevision: string,
    importedAssets?: readonly AgentCenterPresentationAssetMaterial[],
  ) => Promise<AgentCenterRuntimePresentationProfileMutationResult>;
  readonly patchPresentationProfile: (
    input: RuntimeLocalAgentIdentityInput,
    patch: AgentCenterRuntimePresentationProfilePatch,
    expectedRevision: string,
    importedAssets?: readonly AgentCenterPresentationAssetMaterial[],
  ) => Promise<AgentCenterRuntimePresentationProfileMutationResult>;
}

export interface AgentCenterRuntimePresentationProfileMutationResult {
  readonly profile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly previousProfile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly committedRevision: string;
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
  readonly memoryState: 'ready' | 'empty' | 'unavailable';
  readonly recentCanonicalMemoryCount: number;
}

export interface AgentCenterAdvancedDiagnosticsState {
  readonly source: 'runtime-projection' | 'unavailable';
  readonly runtimeTurnId: string | null;
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
  overwriteSharedAIConfig(input: AgentCenterAIConfigMutation): Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
  listSharedAIConfigOptions(input: NimiSharedLocalAgentAIConfigOptionsQuery): Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
  updateAutonomy(input: AgentCenterAutonomyMutation): Promise<void>;
  replaceAppearance(input: AgentCenterPresentationCommitInput): Promise<void>;
  restorePreviousAppearance(): Promise<void>;
  readonly appearance: Readonly<{
    replaceAvatar?: (kind: 'live2d' | 'vrm') => Promise<void>;
    linkLive2dAdapterManifest?: () => Promise<void>;
    clearAvatarAsset?: () => Promise<void>;
    importBackground?: () => Promise<void>;
    clearBackground?: () => Promise<void>;
    removeAgentResources?: () => Promise<void>;
    cleanupGeneratedVoiceArtifacts?: () => Promise<void>;
    setDefaultVoice?: (reference: string) => Promise<void>;
    setAvatarAutoplay?: (enabled: boolean) => Promise<void>;
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

export interface AgentCenterSharedAIConfigModule {
  get(input: { readonly subjectUserId?: string }): Promise<NimiSharedLocalAgentAIConfigSnapshot>;
  overwrite(input: {
    readonly subjectUserId?: string;
    readonly expectedRevision: string;
    readonly capabilities: readonly NimiCapabilityAIConfigIntent[];
    readonly displayProvenance?: NimiJsonObject;
  }): Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
  listOptions(
    input: NimiSharedLocalAgentAIConfigOptionsQuery & { readonly subjectUserId?: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
}
export type AgentCenterAIConfigRouteIntent = AgentCenterAIConfigIntentProjection;
