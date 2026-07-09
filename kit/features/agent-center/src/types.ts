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

export type AgentCenterModelSuperSectionId = 'conversation' | 'voice' | 'media';

export type AgentCenterHostScope =
  | 'account'
  | 'local-agent';

export type AgentCenterModelConfigCopyKey =
  | 'ModelConfig.hub.title'
  | 'ModelConfig.hub.aggregateReady'
  | 'ModelConfig.hub.aggregateAttention'
  | 'ModelConfig.hub.aggregateNeutral'
  | 'ModelConfig.hub.aggregateEmpty'
  | 'ModelConfig.hub.backLabel'
  | 'ModelConfig.hub.detailStatusReady'
  | 'ModelConfig.hub.detailStatusAttention'
  | 'ModelConfig.hub.detailStatusNeutral'
  | 'ModelConfig.hub.detailTitleFormat'
  | 'ModelConfig.hub.activeModelLabel'
  | 'ModelConfig.hub.activeModelHint'
  | 'ModelConfig.hub.activeModelConfiguredLabel'
  | 'ModelConfig.hub.activeModelSetupPendingLabel'
  | 'ModelConfig.profile.sectionTitle'
  | 'ModelConfig.profile.summaryLabel'
  | 'ModelConfig.profile.emptySummaryLabel'
  | 'ModelConfig.profile.applyButtonLabel'
  | 'ModelConfig.profile.changeButtonLabel'
  | 'ModelConfig.profile.manageButtonTitle'
  | 'ModelConfig.profile.modalTitle'
  | 'ModelConfig.profile.modalHint'
  | 'ModelConfig.profile.loadingLabel'
  | 'ModelConfig.profile.emptyLabel'
  | 'ModelConfig.profile.currentBadgeLabel'
  | 'ModelConfig.profile.cancelLabel'
  | 'ModelConfig.profile.confirmLabel'
  | 'ModelConfig.profile.applyingLabel'
  | 'ModelConfig.profile.reloadLabel'
  | 'ModelConfig.profile.importLabel'
  | 'ModelConfig.profile.previewTitle'
  | 'ModelConfig.profile.previewHint'
  | 'ModelConfig.profile.previewingLabel'
  | 'ModelConfig.profile.previewFirstApplyLabel'
  | 'ModelConfig.profile.previewNoChangeLabel'
  | 'ModelConfig.profile.previewBeforeLabel'
  | 'ModelConfig.profile.previewAfterLabel'
  | 'ModelConfig.profile.previewWarningsLabel'
  | 'ModelConfig.profile.previewConfirmLabel'
  | 'ModelConfig.profile.previewBackLabel'
  | 'ModelConfig.section.chat.title'
  | 'ModelConfig.section.tts.title'
  | 'ModelConfig.section.image.title'
  | 'ModelConfig.section.voice.title'
  | 'ModelConfig.section.embed.title'
  | 'ModelConfig.capability.textGenerate.title'
  | 'ModelConfig.capability.textGenerate.subtitle'
  | 'ModelConfig.capability.textGenerate.detail'
  | 'ModelConfig.capability.textEmbed.title'
  | 'ModelConfig.capability.textEmbed.subtitle'
  | 'ModelConfig.capability.textEmbed.detail'
  | 'ModelConfig.capability.audioSynthesize.title'
  | 'ModelConfig.capability.audioSynthesize.subtitle'
  | 'ModelConfig.capability.audioSynthesize.detail'
  | 'ModelConfig.capability.voiceWorkflowVoiceClone.title'
  | 'ModelConfig.capability.voiceWorkflowVoiceClone.subtitle'
  | 'ModelConfig.capability.voiceWorkflowVoiceClone.detail'
  | 'ModelConfig.capability.voiceWorkflowVoiceDesign.title'
  | 'ModelConfig.capability.voiceWorkflowVoiceDesign.subtitle'
  | 'ModelConfig.capability.voiceWorkflowVoiceDesign.detail'
  | 'ModelConfig.capability.imageGenerate.title'
  | 'ModelConfig.capability.imageGenerate.subtitle'
  | 'ModelConfig.capability.imageGenerate.detail'
  | 'ModelConfig.modelPicker.title'
  | 'ModelConfig.modelPicker.local'
  | 'ModelConfig.modelPicker.cloud'
  | 'ModelConfig.modelPicker.selectConnectorLabel'
  | 'ModelConfig.modelPicker.searchPlaceholder'
  | 'ModelConfig.modelPicker.loading'
  | 'ModelConfig.modelPicker.noSearchResults'
  | 'ModelConfig.modelPicker.noModelsAvailable';

export type AgentCenterChromeCopy = Partial<{
  readonly title: string;
  readonly eyebrow: string;
  readonly closeLabel: string;
  readonly navLabel: string;
  readonly textReadyLabel: string;
  readonly avatarFallback: string;
  readonly projectionLoadFailed: string;
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
  readonly modelReadyDescription: string;
  readonly modelPendingDescription: string;
  readonly behaviorReadyDescriptionPrefix: string;
  readonly behaviorReadyEnabledFallback: string;
  readonly behaviorOffDescription: string;
  readonly cognitionFallbackDescription: string;
  readonly readyPill: string;
  readonly needsSetupPill: string;
  readonly enabledPill: string;
  readonly offPill: string;
  readonly projectedPill: string;
  readonly readOnlyPill: string;
}>;

export type AgentCenterAdvancedCopy = Partial<{
  readonly title: string;
  readonly descriptionRuntimeProjection: string;
  readonly descriptionUnavailable: string;
  readonly configRevisionLabel: string;
  readonly runtimeTurnLabel: string;
  readonly runtimeStreamLabel: string;
  readonly runtimeErrorLabel: string;
  readonly unavailableValue: string;
  readonly notProjectedValue: string;
  readonly noneValue: string;
}>;

export type AgentCenterModelCopy = Partial<{
  readonly sectionTitle: string;
  readonly superSectionLabels: Partial<Record<AgentCenterModelSuperSectionId, string>>;
  readonly modelConfig: Partial<Record<AgentCenterModelConfigCopyKey, string>>;
  readonly detailActiveModelHint: string;
  readonly setupRequiredLabel: string;
  readonly runtimeModelPickerUnavailableLabel: string;
  readonly notConfiguredLabel: string;
  readonly profileImportUnsupportedLabel: string;
  readonly profileImportUnavailableLabel: string;
  readonly profilePreviewUnsupportedLabel: string;
  readonly profileFirstApplyLabel: string;
  readonly parameterEditRejected: string;
  readonly profileSliceRefRejected: string;
  readonly adapterUnavailable: string;
  readonly revisionUnavailable: string;
  readonly savingStatus: string;
  readonly savedStatusFormat: string;
  readonly updateFailed: string;
  readonly projectionReadyBadge: string;
  readonly projectionReadyTitle: string;
  readonly projectionNeedsSetupBadge: string;
  readonly projectionRouteNotConfiguredTitle: string;
  readonly projectionModelRequiredTitle: string;
  readonly projectionUnavailableTitle: string;
  readonly modelSelectionUnresolvedSuffix: string;
}>;

export type AgentCenterCopy = Partial<{
  readonly sectionLabels: Partial<Record<AgentCenterSectionId, string>>;
  readonly capabilityLabels: Partial<Record<AgentCenterCapabilityId, string>>;
  readonly chrome: AgentCenterChromeCopy;
  readonly progress: AgentCenterProgressCopy;
  readonly overview: AgentCenterOverviewCopy;
  readonly advanced: AgentCenterAdvancedCopy;
  readonly model: AgentCenterModelCopy;
}>;

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
  readonly previewState?: 'ready' | 'failed' | 'loading' | 'unavailable' | null;
  readonly previewTier?: 'avatar_preview_service' | string | null;
  readonly previewArtifactRef?: string | null;
  readonly previewImageRef?: string | null;
  readonly previewFailureReason?: string | null;
  readonly previewWarnings?: readonly string[];
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
  readonly removeAgentResources?: () => Promise<AgentCenterAppearanceProjection>;
  readonly removeAccountResources?: () => Promise<AgentCenterAppearanceProjection>;
  readonly cleanupGeneratedVoiceArtifacts?: () => Promise<AgentCenterAppearanceProjection>;
  readonly setAvatarAutoplay?: (enabled: boolean) => Promise<AgentCenterAppearanceProjection>;
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
  readonly patchPresentationProfile: (
    input: RuntimeLocalAgentIdentityInput,
    patch: AgentCenterRuntimePresentationProfilePatch,
  ) => Promise<void>;
  readonly setPresentationProfile?: (
    input: RuntimeLocalAgentIdentityInput,
    profile: AgentCenterRuntimePresentationProfilePatch | null,
  ) => Promise<void>;
}

export type AgentCenterAppearanceCopy = Partial<{
  readonly appearanceTitle: string;
  readonly appearanceDescription: string;
  readonly avatarCardTitle: string;
  readonly avatarUnsetTitle: string;
  readonly avatarUnsetDescription: string;
  readonly importLive2dButton: string;
  readonly importVrmButton: string;
  readonly supportedFormatsLabel: string;
  readonly viewSupportedFormats: string;
  readonly currentAvatarPrefix: string;
  readonly assetImported: string;
  readonly avatarReadyHint: string;
  readonly avatarSetupHint: string;
  readonly avatarMissingTitle: string;
  readonly avatarImportPrimary: string;
  readonly blockedScopeTitle: string;
  readonly blockedScopeDescription: string;
  readonly blockedScopeHint: string;
  readonly blockedBridgeTitle: string;
  readonly blockedBridgeDescription: string;
  readonly blockedBridgeHint: string;
  readonly blockedGenericTitle: string;
  readonly blockedGenericDescription: string;
  readonly blockedGenericHint: string;
  readonly continueSetup: string;
  readonly changeAvatar: string;
  readonly progressTitle: string;
  readonly progressCompleteLabel: string;
  readonly stepAssetTitle: string;
  readonly stepAssetReady: string;
  readonly stepAssetMissing: string;
  readonly stepValidationTitle: string;
  readonly stepValidationReady: string;
  readonly stepValidationMissing: string;
  readonly stepSidecarTitle: string;
  readonly stepSidecarReady: string;
  readonly stepSidecarPending: string;
  readonly stepDisplayTitle: string;
  readonly stepDisplayReady: string;
  readonly stepDisplayPending: string;
  readonly doneLabel: string;
  readonly pendingLabel: string;
  readonly notStartedLabel: string;
  readonly selectSidecar: string;
  readonly assetManagementTitle: string;
  readonly importLive2dTitle: string;
  readonly importLive2dSubtitle: string;
  readonly live2dImported: string;
  readonly importVrmTitle: string;
  readonly importVrmSubtitle: string;
  readonly importOtherFormat: string;
  readonly removeAvatar: string;
  readonly chatBackgroundTitle: string;
  readonly chatBackgroundDescription: string;
  readonly backgroundUnset: string;
  readonly backgroundReady: string;
  readonly uploadBackground: string;
  readonly chooseRecommendedBackground: string;
  readonly technicalDetailsTitle: string;
  readonly technicalDetailsDescription: string;
  readonly diagnosticsEvidenceTitle: string;
  readonly selectedAssetLabel: string;
  readonly validationLabel: string;
  readonly capabilityProfileLabel: string;
  readonly live2dManifestLabel: string;
  readonly linkedLabel: string;
  readonly pendingEvidenceLabel: string;
  readonly missingLabel: string;
  readonly avatarAutoplayLabel: string;
  readonly avatarAutoplayDescription: string;
  readonly enableLabel: string;
  readonly disableLabel: string;
  readonly voiceArtifactsLabel: string;
  readonly voiceArtifactsDescription: string;
  readonly cleanupLabel: string;
  readonly cleaningLabel: string;
  readonly appearanceUpdateFailed: string;
  readonly live2dStatusProbeRequired: string;
  readonly live2dStatusNotAdmitted: string;
  readonly live2dStatusEffectPending: string;
  readonly live2dStatusChecking: string;
  readonly live2dStatusReady: string;
  readonly live2dStatusPending: string;
  readonly live2dStatusMissing: string;
  readonly live2dStatusBlocked: string;
  readonly live2dPreviewArtifactLabel: string;
  readonly live2dModelFramingLabel: string;
  readonly live2dRenderPolicyLabel: string;
  readonly live2dExpressionInventoryLabel: string;
  readonly live2dAdapterManifestEvidenceLabel: string;
  readonly live2dEvidenceRequired: string;
  readonly live2dPreviewReadyDetail: string;
  readonly live2dCalibrationPendingDetail: string;
  readonly live2dEmotionReadyDetail: string;
  readonly live2dBackendRequiredDetail: string;
  readonly live2dExternalSidecarSelected: string;
  readonly live2dEmbeddedManifestSelected: string;
  readonly live2dNoAdapterManifestSelected: string;
  readonly evidenceRefLabel: string;
  readonly calibrationRefLabel: string;
  readonly custodyNotice: string;
  readonly adapterUnavailableFormat: string;
}>;

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
  readonly autonomyDisabledReason?: string | null;
}

export interface AgentCenterProps {
  readonly state: AgentCenterState | AgentCenterStateInput;
  readonly activeSection?: AgentCenterSectionId;
  readonly defaultSection?: AgentCenterSectionId;
  readonly onSectionChange?: (section: AgentCenterSectionId) => void;
  readonly runtimeAdapter?: AgentCenterRuntimeAdapter | null;
  readonly appearanceAdapter?: AgentCenterAppearanceAdapter | null;
  readonly copy?: AgentCenterCopy;
  readonly appearanceCopy?: AgentCenterAppearanceCopy;
  readonly behaviorCopy?: AgentCenterBehaviorCopy;
  readonly placementActions?: AgentCenterPlacementActions;
  readonly identity?: AgentCenterIdentityProjection | null;
  readonly chrome?: 'standalone' | 'embedded';
  readonly ariaLabel?: string;
}

export type AgentCenterAgentAIConfigIntents = NimiRuntimeAgentAIConfigIntents;
export type AgentCenterRuntimeAIConfigBinding = NimiRuntimeAgentAIConfigBinding;
