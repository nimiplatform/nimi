import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AgentCenter,
  type AgentCenterAppearanceAdapter,
  type AgentCenterCopy,
  type AgentCenterSectionId,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from './capability-settings-shared';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type AgentConversationSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
  appearanceAdapter: AgentCenterAppearanceAdapter | null;
};

export function AgentConversationSettingsContent(props: AgentConversationSettingsContentProps) {
  const { input } = props;
  const [activeSection, setActiveSection] = useState<AgentCenterSectionId>('overview');
  const [boundedContext, setBoundedContext] = useState<{
    sourceContextStatus: Awaited<ReturnType<NonNullable<typeof input.runtimeAgentCenterAdapter>['loadSnapshot']>>['sourceContextStatus'];
    turnContextSummary: Awaited<ReturnType<NonNullable<typeof input.runtimeAgentCenterAdapter>['loadSnapshot']>>['turnContextSummary'];
  } | null>(null);
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
  useEffect(() => {
    let cancelled = false;
    if (!runtimeAdapter) {
      setBoundedContext(null);
      return () => { cancelled = true; };
    }
    void runtimeAdapter.loadSnapshot().then((snapshot) => {
      if (!cancelled) {
        setBoundedContext({
          sourceContextStatus: snapshot.sourceContextStatus,
          turnContextSummary: snapshot.turnContextSummary,
        });
      }
    }).catch(() => {
      if (!cancelled) setBoundedContext(null);
    });
    return () => { cancelled = true; };
  }, [runtimeAdapter]);
  const state = useMemo<AgentCenterStateInput>(() => ({
    agentAIConfig: input.runtimeAgentAIConfig,
    readiness: input.runtimeAgentAIConfigReadiness,
    inspect: input.runtimeInspect,
    runtimeError: input.runtimeAgentAIConfigError,
    sourceContextStatus: boundedContext?.sourceContextStatus ?? null,
    turnContextSummary: boundedContext?.turnContextSummary ?? null,
    autonomyMutationAvailable: Boolean(runtimeAdapter?.setAutonomyConfig),
  }), [
    input.runtimeAgentAIConfig,
    input.runtimeAgentAIConfigError,
    input.runtimeAgentAIConfigReadiness,
    input.runtimeInspect,
    boundedContext,
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
        'ModelConfig.hub.activeModelLabel': input.t('Chat.agentCenterModelRoute', { defaultValue: 'Model route' }),
        'ModelConfig.hub.activeModelHint': input.t('Chat.agentCenterModelPickerHint', { defaultValue: 'Click to change model' }),
        'ModelConfig.hub.activeModelConfiguredLabel': input.t('Chat.agentCenterReady', { defaultValue: 'Ready' }),
        'ModelConfig.hub.activeModelSetupPendingLabel': input.t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' }),
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
        'ModelConfig.capability.textGenerate.title': input.t('Chat.agentCenterCapabilityTextGenerate', { defaultValue: 'Text generation' }),
        'ModelConfig.capability.textGenerate.subtitle': input.t('Chat.agentCenterCapabilityTextGenerate', { defaultValue: 'Text generation' }),
        'ModelConfig.capability.textGenerate.detail': input.t('Chat.agentCenterCapabilityTextGenerate', { defaultValue: 'Text generation' }),
        'ModelConfig.capability.textEmbed.title': input.t('Chat.agentCenterCapabilityTextEmbed', { defaultValue: 'Embedding' }),
        'ModelConfig.capability.textEmbed.subtitle': input.t('Chat.agentCenterCapabilityTextEmbed', { defaultValue: 'Embedding' }),
        'ModelConfig.capability.textEmbed.detail': input.t('Chat.agentCenterCapabilityTextEmbed', { defaultValue: 'Embedding' }),
        'ModelConfig.capability.audioSynthesize.title': input.t('Chat.agentCenterCapabilityAudioSynthesize', { defaultValue: 'Speech synthesis' }),
        'ModelConfig.capability.audioSynthesize.subtitle': input.t('Chat.agentCenterCapabilityAudioSynthesize', { defaultValue: 'Speech synthesis' }),
        'ModelConfig.capability.audioSynthesize.detail': input.t('Chat.agentCenterCapabilityAudioSynthesize', { defaultValue: 'Speech synthesis' }),
        'ModelConfig.capability.voiceWorkflowVoiceClone.title': input.t('Chat.agentCenterCapabilityVoiceClone', { defaultValue: 'Voice clone' }),
        'ModelConfig.capability.voiceWorkflowVoiceClone.subtitle': input.t('Chat.agentCenterCapabilityVoiceClone', { defaultValue: 'Voice clone' }),
        'ModelConfig.capability.voiceWorkflowVoiceClone.detail': input.t('Chat.agentCenterCapabilityVoiceClone', { defaultValue: 'Voice clone' }),
        'ModelConfig.capability.voiceWorkflowVoiceDesign.title': input.t('Chat.agentCenterCapabilityVoiceDesign', { defaultValue: 'Voice design' }),
        'ModelConfig.capability.voiceWorkflowVoiceDesign.subtitle': input.t('Chat.agentCenterCapabilityVoiceDesign', { defaultValue: 'Voice design' }),
        'ModelConfig.capability.voiceWorkflowVoiceDesign.detail': input.t('Chat.agentCenterCapabilityVoiceDesign', { defaultValue: 'Voice design' }),
        'ModelConfig.capability.imageGenerate.title': input.t('Chat.agentCenterCapabilityImageGenerate', { defaultValue: 'Image generation' }),
        'ModelConfig.capability.imageGenerate.subtitle': input.t('Chat.agentCenterCapabilityImageGenerate', { defaultValue: 'Image generation' }),
        'ModelConfig.capability.imageGenerate.detail': input.t('Chat.agentCenterCapabilityImageGenerate', { defaultValue: 'Image generation' }),
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
      appearanceAdapter={props.appearanceAdapter}
      chrome="embedded"
      copy={agentCenterCopy}
      onSectionChange={setActiveSection}
      runtimeAdapter={runtimeAdapter}
      state={state}
    />
  );
}
