import {
  useMemo,
  useState,
} from 'react';
import {
  AgentCenter,
  type AgentCenterAppearanceAdapter,
  type AgentCenterAppearanceConfigPatch,
  type AgentCenterAppearanceProjection,
  type AgentCenterCopy,
  type AgentCenterSectionId,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from './capability-settings-shared';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type {
  AgentCenterAvatarAssetKind,
  AgentCenterAvatarAssetModule,
  AgentCenterAvatarConfigPatch,
} from './chat-agent-center-avatar-config-types';
import type {
  AgentCenterVoiceModule,
} from './chat-agent-center-local-config';
import type {
  AvatarAssetValidationPresentation,
  DecommissionedAvatarAssetLibraryResult,
} from './chat-agent-shell-avatar-asset-diagnostics';

type MutationLike<TArg = void> = {
  error: unknown;
  isPending: boolean;
  mutate: [TArg] extends [void] ? () => void : (arg: TArg) => void;
  mutateAsync?: [TArg] extends [void] ? () => Promise<unknown> : (arg: TArg) => Promise<unknown>;
};

type BackgroundQueryLike = {
  data?: {
    validation?: {
      status?: string;
      errors?: Array<{ message?: string }>;
    } | null;
  } | null;
  isFetching: boolean;
};

type AvatarAssetLibraryQueryLike = {
  data?: DecommissionedAvatarAssetLibraryResult | null;
  error?: unknown;
  isFetching: boolean;
};

type BackgroundValidation = {
  status?: string;
  errors?: Array<{ message?: string }>;
} | null | undefined;

type AgentConversationSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
  avatarAssetValid: boolean;
  backgroundValid: boolean;
  avatarAssetChecking: boolean;
  avatarAssetConfig: AgentCenterAvatarAssetModule | null;
  avatarVoicePolicy: AgentCenterVoiceModule | null;
  avatarAssetValidationPresentation: AvatarAssetValidationPresentation;
  avatarConfigMutation: MutationLike<AgentCenterAvatarConfigPatch>;
  voicePolicyMutation: MutationLike<{ avatar_autoplay: boolean }>;
  voiceArtifactCleanupMutation: MutationLike;
  avatarAssetImportMutation: MutationLike<AgentCenterAvatarAssetKind>;
  avatarAssetLibraryQuery: AvatarAssetLibraryQueryLike;
  avatarAssetSelectMutation: MutationLike<string>;
  avatarImportDisabled: boolean;
  avatarImportError: string | null;
  clearAvatarAssetMutation: MutationLike;
  live2dAdapterManifestImportMutation: MutationLike;
  selectedBackgroundAssetId: string | null | undefined;
  backgroundAssetQuery: BackgroundQueryLike;
  backgroundValidation: BackgroundValidation;
  backgroundImportError: string | null;
  clearBackgroundMutation: MutationLike;
  backgroundImportDisabled: boolean;
  backgroundImportMutation: MutationLike;
};

function buildAppearanceProjection(input: AgentConversationSettingsContentProps): AgentCenterAppearanceProjection {
  const avatarAssetRef = input.avatarAssetConfig?.local_avatar_asset_ref || null;
  const backgroundRef = input.selectedBackgroundAssetId || null;
  const avatarStatus = input.avatarAssetChecking
    ? 'loading'
    : input.avatarAssetValid
      ? 'ready'
      : avatarAssetRef
        ? 'invalid'
        : 'not_configured';
  const backgroundStatus = input.backgroundValid
    ? 'ready'
    : backgroundRef && input.backgroundValidation?.status
      ? 'invalid'
      : 'not_configured';
  const status: AgentCenterAppearanceProjection['status'] = avatarStatus === 'ready' && backgroundStatus !== 'invalid'
    ? 'ready'
    : avatarStatus;
  return {
    status,
    backendKind: input.avatarAssetConfig?.backend_kind || null,
    avatarAssetRef,
    avatarAssetValid: input.avatarAssetValid,
    avatarAssetChecking: input.avatarAssetChecking,
    validationStatus: input.avatarAssetValidationPresentation.validationStatus,
    validationMessage: input.avatarAssetValidationPresentation.message,
    validationIssueRows: input.avatarAssetValidationPresentation.issueRows,
    backendCapabilityProfileRef: input.avatarAssetConfig?.backend_capability_profile_ref || null,
    live2dAdapterManifestSource: input.avatarAssetConfig?.live2d_adapter_manifest_source || 'none',
    live2dAdapterManifestRef: input.avatarAssetConfig?.live2d_adapter_manifest_ref || null,
    live2dCalibrationRef: input.avatarAssetConfig?.live2d_calibration_ref || null,
    backgroundRef,
    backgroundValid: input.backgroundValid,
    backgroundChecking: input.backgroundAssetQuery.isFetching,
    backgroundValidationStatus: input.backgroundValidation?.status || null,
    backgroundValidationMessage: input.backgroundValidation?.errors?.[0]?.message || null,
    backgroundImportError: input.backgroundImportError,
    defaultVoiceReference: null,
    avatarAutoplay: input.avatarVoicePolicy?.avatar_autoplay === true,
    avatarImportDisabled: input.avatarImportDisabled,
    backgroundImportDisabled: input.backgroundImportDisabled,
    voiceCleanupPending: input.voiceArtifactCleanupMutation.isPending,
    voiceCleanupError: input.voiceArtifactCleanupMutation.error instanceof Error ? input.voiceArtifactCleanupMutation.error.message : null,
    avatarConfigPending: input.avatarConfigMutation.isPending,
    avatarImportPending: input.avatarAssetImportMutation.isPending,
    live2dAdapterImportPending: input.live2dAdapterManifestImportMutation.isPending,
    clearAvatarPending: input.clearAvatarAssetMutation.isPending,
    backgroundImportPending: input.backgroundImportMutation.isPending,
    clearBackgroundPending: input.clearBackgroundMutation.isPending,
    avatarImportError: input.avatarImportError,
    avatarInstancePolicy: input.avatarAssetConfig?.avatar_instance_policy || 'reuse_active_instance',
    generatedMotionProviderPolicy: input.avatarAssetConfig?.generated_motion_provider_policy || 'require_profile_support',
    launchMode: input.avatarAssetConfig?.launch_mode || 'manual',
    debugProfile: input.avatarAssetConfig?.debug_profile || 'standard',
    developerModeEnabled: input.input.developerModeEnabled,
    disabledReason: status === 'ready'
      ? null
      : avatarStatus === 'invalid'
        ? 'Avatar asset is not admitted for launch.'
        : 'Avatar asset is not configured.',
  };
}

async function runMutation<TArg>(
  mutation: MutationLike<TArg>,
  arg: TArg,
): Promise<void> {
  if (mutation.mutateAsync) {
    await mutation.mutateAsync(arg);
    return;
  }
  (mutation.mutate as (arg: TArg) => void)(arg);
}

async function runVoidMutation(mutation: MutationLike): Promise<void> {
  if (mutation.mutateAsync) {
    await mutation.mutateAsync();
    return;
  }
  mutation.mutate();
}

export function AgentConversationSettingsContent(props: AgentConversationSettingsContentProps) {
  const { input } = props;
  const [activeSection, setActiveSection] = useState<AgentCenterSectionId>('overview');
  const localAssetsQuery = useLocalAssets({ enabled: activeSection === 'model' });
  const localAssetSource = useMemo(() => ({
    loading: localAssetsQuery.isFetching,
    list: () => localAssetsQuery.data || [],
  }), [localAssetsQuery.data, localAssetsQuery.isFetching]);
  const runtimeAdapter = useMemo(() => {
    if (!input.runtimeAgentCenterAdapter) {
      return null;
    }
    return {
      ...input.runtimeAgentCenterAdapter,
      modelConfig: {
        ...input.runtimeAgentCenterAdapter.modelConfig,
        localAssetSource,
        providerResolver: getDesktopRouteModelPickerProvider,
      },
    };
  }, [input.runtimeAgentCenterAdapter, localAssetSource]);
  const appearanceProjection = useMemo(() => buildAppearanceProjection(props), [
    input.developerModeEnabled,
    props.avatarAssetChecking,
    props.avatarAssetConfig,
    props.avatarAssetImportMutation.isPending,
    props.avatarAssetValid,
    props.avatarAssetValidationPresentation.issueRows,
    props.avatarAssetValidationPresentation.message,
    props.avatarAssetValidationPresentation.validationStatus,
    props.avatarConfigMutation.isPending,
    props.avatarImportDisabled,
    props.avatarImportError,
    props.avatarVoicePolicy?.avatar_autoplay,
    props.backgroundAssetQuery.isFetching,
    props.backgroundImportDisabled,
    props.backgroundImportError,
    props.backgroundImportMutation.isPending,
    props.backgroundValid,
    props.backgroundValidation,
    props.clearAvatarAssetMutation.isPending,
    props.clearBackgroundMutation.isPending,
    props.live2dAdapterManifestImportMutation.isPending,
    props.selectedBackgroundAssetId,
    props.voiceArtifactCleanupMutation.error,
    props.voiceArtifactCleanupMutation.isPending,
  ]);
  const appearanceAdapter = useMemo<AgentCenterAppearanceAdapter>(() => ({
    load: async () => appearanceProjection,
    importAvatarAsset: async (kind) => {
      await runMutation(props.avatarAssetImportMutation, kind);
      return appearanceProjection;
    },
    linkLive2dAdapterManifest: async () => {
      await runVoidMutation(props.live2dAdapterManifestImportMutation);
      return appearanceProjection;
    },
    clearAvatarAsset: async () => {
      await runVoidMutation(props.clearAvatarAssetMutation);
      return appearanceProjection;
    },
    importBackground: async () => {
      await runVoidMutation(props.backgroundImportMutation);
      return appearanceProjection;
    },
    clearBackground: async () => {
      await runVoidMutation(props.clearBackgroundMutation);
      return appearanceProjection;
    },
    updateAvatarConfig: async (patch: AgentCenterAppearanceConfigPatch) => {
      const avatarPatch: AgentCenterAvatarConfigPatch = {
        ...(patch.avatar_instance_policy ? { avatar_instance_policy: patch.avatar_instance_policy as AgentCenterAvatarConfigPatch['avatar_instance_policy'] } : {}),
        ...(patch.generated_motion_provider_policy ? { generated_motion_provider_policy: patch.generated_motion_provider_policy as AgentCenterAvatarConfigPatch['generated_motion_provider_policy'] } : {}),
        ...(patch.launch_mode ? { launch_mode: patch.launch_mode as AgentCenterAvatarConfigPatch['launch_mode'] } : {}),
        ...(patch.debug_profile ? { debug_profile: patch.debug_profile as AgentCenterAvatarConfigPatch['debug_profile'] } : {}),
      };
      await runMutation(props.avatarConfigMutation, avatarPatch);
      return appearanceProjection;
    },
    cleanupGeneratedVoiceArtifacts: async () => {
      await runVoidMutation(props.voiceArtifactCleanupMutation);
      return appearanceProjection;
    },
    setAvatarAutoplay: async (enabled) => {
      await runMutation(props.voicePolicyMutation, { avatar_autoplay: enabled });
      return appearanceProjection;
    },
  }), [
    appearanceProjection,
    props.avatarAssetImportMutation,
    props.avatarConfigMutation,
    props.backgroundImportMutation,
    props.clearAvatarAssetMutation,
    props.clearBackgroundMutation,
    props.live2dAdapterManifestImportMutation,
    props.voiceArtifactCleanupMutation,
    props.voicePolicyMutation,
  ]);
  const state = useMemo<AgentCenterStateInput>(() => ({
    agentAIConfig: input.runtimeAgentAIConfig,
    readiness: input.runtimeAgentAIConfigReadiness,
    inspect: input.runtimeInspect,
    runtimeError: input.runtimeAgentAIConfigError,
    autonomyMutationAvailable: Boolean(runtimeAdapter?.setAutonomyConfig),
    appearance: appearanceProjection,
  }), [
    appearanceProjection,
    input.runtimeAgentAIConfig,
    input.runtimeAgentAIConfigError,
    input.runtimeAgentAIConfigReadiness,
    input.runtimeInspect,
    runtimeAdapter?.setAutonomyConfig,
  ]);
  const agentCenterCopy = useMemo<AgentCenterCopy>(() => ({
    chrome: {
      title: input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' }),
      eyebrow: input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' }),
      closeLabel: input.t('Chat.agentCenterClose', { defaultValue: 'Close Agent Center' }),
      navLabel: input.t('Chat.agentCenterNavigation', { defaultValue: 'Agent Center sections' }),
      textReadyLabel: input.t('Chat.agentCenterTextReady', { defaultValue: 'Runtime text turns ready' }),
      projectionLoadFailed: input.t('Chat.agentCenterProjectionLoadFailed', { defaultValue: 'Runtime Agent Center projection load failed.' }),
    },
    progress: {
      configLabel: input.t('Chat.agentCenterHeroSetupLabel', { defaultValue: 'Setup' }),
    },
    sectionLabels: {
      overview: input.t('Chat.agentCenterOverview', { defaultValue: 'Overview' }),
      model: input.t('Chat.agentCenterModel', { defaultValue: 'Model' }),
      behavior: input.t('Chat.agentCenterBehaviorCompact', { defaultValue: 'Behavior' }),
      cognition: input.t('Chat.agentCenterCognition', { defaultValue: 'Cognition' }),
      appearance: input.t('Chat.agentCenterAppearance', { defaultValue: 'Appearance' }),
      advanced: input.t('Chat.agentCenterAdvanced', { defaultValue: 'Advanced' }),
    },
    model: {
      sectionTitle: input.t('Chat.agentCenterModel', { defaultValue: 'Model' }),
      superSectionLabels: {
        conversation: input.t('Chat.agentCenterSuperSectionConversation', { defaultValue: 'Conversation' }),
        voice: input.t('Chat.agentCenterSuperSectionVoice', { defaultValue: 'Voice' }),
        media: input.t('Chat.agentCenterSuperSectionMedia', { defaultValue: 'Media' }),
      },
      detailActiveModelHint: input.t('Chat.agentCenterModelPickerHint', { defaultValue: 'Click to change model' }),
      setupRequiredLabel: input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' }),
      runtimeModelPickerUnavailableLabel: input.t('Chat.agentCenterModelPickerUnavailable', { defaultValue: 'Runtime model picker unavailable' }),
      notConfiguredLabel: input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' }),
      adapterUnavailable: input.t('Chat.agentCenterModelStatusAdapterUnavailable', { defaultValue: 'Runtime Agent AI Config adapter unavailable.' }),
      revisionUnavailable: input.t('Chat.agentCenterModelStatusRevisionUnavailable', { defaultValue: 'Runtime Agent AI Config revision unavailable.' }),
      savingStatus: input.t('Chat.agentCenterModelStatusSaving', { defaultValue: 'Saving Runtime Agent AI Config model selection.' }),
      savedStatusFormat: input.t('Chat.agentCenterModelStatusSaved', { defaultValue: 'Saved Runtime Agent AI Config revision {{revision}}.' }),
      updateFailed: input.t('Chat.agentCenterModelStatusUpdateFailed', { defaultValue: 'Runtime Agent AI Config update failed.' }),
      projectionReadyBadge: input.t('Chat.agentCenterReady', { defaultValue: 'Ready' }),
      projectionReadyTitle: input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' }),
      projectionNeedsSetupBadge: input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' }),
      projectionRouteNotConfiguredTitle: input.t('Chat.agentCenterRouteNotConfigured', { defaultValue: 'Runtime route not configured' }),
      projectionModelRequiredTitle: input.t('Chat.agentCenterModelSelectionRequired', { defaultValue: 'Model selection required' }),
      projectionUnavailableTitle: input.t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' }),
      modelConfig: {
        'ModelConfig.hub.title': input.t('Chat.settingsAiModelEntryTitle', { defaultValue: 'AI Model' }),
        'ModelConfig.hub.aggregateReady': input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' }),
        'ModelConfig.hub.aggregateAttention': input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' }),
        'ModelConfig.hub.aggregateNeutral': input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' }),
        'ModelConfig.hub.aggregateEmpty': input.t('Chat.agentCenterNoModelRoutes', { defaultValue: 'No model routes configured' }),
        'ModelConfig.hub.backLabel': input.t('Chat.settingsBack', { defaultValue: 'Back' }),
        'ModelConfig.hub.detailStatusReady': input.t('Chat.settingsRuntimeReady', { defaultValue: 'Runtime ready' }),
        'ModelConfig.hub.detailStatusAttention': input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' }),
        'ModelConfig.hub.detailStatusNeutral': input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' }),
        'ModelConfig.hub.detailTitleFormat': input.t('Chat.agentCenterModelConfigTitleFormat', { defaultValue: '{{section}} Configuration' }),
        'ModelConfig.hub.activeModelLabel': input.t('Chat.settingsActive', { defaultValue: 'Active' }),
        'ModelConfig.hub.activeModelHint': input.t('Chat.agentCenterModelPickerHint', { defaultValue: 'Click to change model' }),
        'ModelConfig.hub.activeModelConfiguredLabel': input.t('Chat.agentCenterLinked', { defaultValue: 'Linked' }),
        'ModelConfig.hub.activeModelSetupPendingLabel': input.t('Chat.agentCenterPending', { defaultValue: 'Pending' }),
        'ModelConfig.profile.sectionTitle': input.t('Chat.agentCenterAiProfile', { defaultValue: 'AI Profile' }),
        'ModelConfig.profile.summaryLabel': input.t('Chat.agentCenterAiProfile', { defaultValue: 'AI Profile' }),
        'ModelConfig.profile.emptySummaryLabel': input.t('Chat.agentCenterNoProfileApplied', { defaultValue: 'No profile applied' }),
        'ModelConfig.profile.applyButtonLabel': input.t('Chat.agentCenterApply', { defaultValue: 'Apply' }),
        'ModelConfig.profile.changeButtonLabel': input.t('Chat.agentCenterChange', { defaultValue: 'Change' }),
        'ModelConfig.profile.manageButtonTitle': input.t('Chat.agentCenterManageProfiles', { defaultValue: 'Manage profiles' }),
        'ModelConfig.profile.modalTitle': input.t('Chat.agentCenterImportAiProfile', { defaultValue: 'Import AI Profile' }),
        'ModelConfig.profile.modalHint': input.t('Chat.agentCenterAiProfileImportUnsupported', { defaultValue: 'Runtime Agent AI Config profile import is not admitted on this surface yet.' }),
        'ModelConfig.profile.loadingLabel': input.t('Chat.agentCenterLoadingProfiles', { defaultValue: 'Loading profiles...' }),
        'ModelConfig.profile.emptyLabel': input.t('Chat.agentCenterNoProfilesAvailable', { defaultValue: 'Profile import is not available for Runtime Agent AI Config.' }),
        'ModelConfig.profile.currentBadgeLabel': input.t('Chat.agentCenterCurrent', { defaultValue: 'Current' }),
        'ModelConfig.profile.cancelLabel': input.t('Chat.agentCenterCancel', { defaultValue: 'Cancel' }),
        'ModelConfig.profile.confirmLabel': input.t('Chat.agentCenterConfirm', { defaultValue: 'Confirm' }),
        'ModelConfig.profile.applyingLabel': input.t('Chat.agentCenterApplying', { defaultValue: 'Applying...' }),
        'ModelConfig.profile.reloadLabel': input.t('Chat.agentCenterReload', { defaultValue: 'Reload' }),
        'ModelConfig.profile.importLabel': input.t('Chat.agentCenterImportAiProfile', { defaultValue: 'Import AI Profile' }),
        'ModelConfig.profile.previewTitle': input.t('Chat.agentCenterPreviewProfile', { defaultValue: 'Preview Profile' }),
        'ModelConfig.profile.previewHint': input.t('Chat.agentCenterPreviewProfileHint', { defaultValue: 'Review Runtime Agent AI Config changes before applying.' }),
        'ModelConfig.profile.previewingLabel': input.t('Chat.agentCenterPreviewing', { defaultValue: 'Previewing...' }),
        'ModelConfig.profile.previewFirstApplyLabel': input.t('Chat.agentCenterPreviewFirstApply', { defaultValue: 'This is the first profile apply for this surface.' }),
        'ModelConfig.profile.previewNoChangeLabel': input.t('Chat.agentCenterPreviewNoChange', { defaultValue: 'No changes.' }),
        'ModelConfig.profile.previewBeforeLabel': input.t('Chat.agentCenterBefore', { defaultValue: 'Before' }),
        'ModelConfig.profile.previewAfterLabel': input.t('Chat.agentCenterAfter', { defaultValue: 'After' }),
        'ModelConfig.profile.previewWarningsLabel': input.t('Chat.agentCenterWarnings', { defaultValue: 'Warnings' }),
        'ModelConfig.profile.previewConfirmLabel': input.t('Chat.agentCenterApplyProfile', { defaultValue: 'Apply profile' }),
        'ModelConfig.profile.previewBackLabel': input.t('Chat.settingsBack', { defaultValue: 'Back' }),
        'ModelConfig.section.chat.title': input.t('Chat.settingsChatSection', { defaultValue: 'Chat' }),
        'ModelConfig.section.embed.title': input.t('Chat.settingsEmbedSection', { defaultValue: 'Embedding' }),
        'ModelConfig.section.tts.title': input.t('Chat.settingsTtsSection', { defaultValue: 'Speech' }),
        'ModelConfig.section.voice.title': input.t('Chat.agentCenterSuperSectionVoice', { defaultValue: 'Voice' }),
        'ModelConfig.section.image.title': input.t('Chat.settingsImageSection', { defaultValue: 'Image' }),
        'ModelConfig.capability.textGenerate.title': input.t('Chat.agentCenterCapabilityTextGenerate', { defaultValue: 'Text Generation' }),
        'ModelConfig.capability.textEmbed.title': input.t('Chat.agentCenterCapabilityTextEmbed', { defaultValue: 'Embedding' }),
        'ModelConfig.capability.audioSynthesize.title': input.t('Chat.agentCenterCapabilityAudioSynthesize', { defaultValue: 'Speech Synthesis' }),
        'ModelConfig.capability.voiceWorkflowVoiceClone.title': input.t('Chat.agentCenterCapabilityVoiceClone', { defaultValue: 'Voice Clone' }),
        'ModelConfig.capability.voiceWorkflowVoiceDesign.title': input.t('Chat.agentCenterCapabilityVoiceDesign', { defaultValue: 'Voice Design' }),
        'ModelConfig.capability.imageGenerate.title': input.t('Chat.agentCenterCapabilityImageGenerate', { defaultValue: 'Image Generation' }),
        'ModelConfig.modelPicker.title': input.t('Chat.agentCenterModelPickerTitle', { defaultValue: 'Select Model' }),
        'ModelConfig.modelPicker.local': input.t('Chat.settingsLocal', { defaultValue: 'Local' }),
        'ModelConfig.modelPicker.cloud': input.t('Chat.settingsCloud', { defaultValue: 'Cloud' }),
        'ModelConfig.modelPicker.selectConnectorLabel': input.t('Chat.agentCenterModelPickerSelectConnector', { defaultValue: 'Select connector' }),
        'ModelConfig.modelPicker.searchPlaceholder': input.t('Chat.agentCenterModelPickerSearch', { defaultValue: 'Search models' }),
        'ModelConfig.modelPicker.loading': input.t('Chat.settingsLoading', { defaultValue: 'Loading models...' }),
        'ModelConfig.modelPicker.noSearchResults': input.t('Chat.agentCenterModelPickerNoMatches', { defaultValue: 'No models match your search.' }),
        'ModelConfig.modelPicker.noModelsAvailable': input.t('Chat.agentCenterModelPickerNoModels', { defaultValue: 'No models available.' }),
      },
    },
  }), [input]);
  return (
    <AgentCenter
      activeSection={activeSection}
      ariaLabel={input.t('Chat.agentCenterTitle', { defaultValue: 'Agent Center' })}
      appearanceAdapter={appearanceAdapter}
      chrome="embedded"
      copy={agentCenterCopy}
      onSectionChange={setActiveSection}
      runtimeAdapter={runtimeAdapter}
      state={state}
    />
  );
}
