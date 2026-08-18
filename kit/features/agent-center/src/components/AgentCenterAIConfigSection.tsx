import { useMemo } from 'react';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCopy,
} from '@nimiplatform/kit/features/model-config';
import type {
  AgentCenterI18n,
  AgentCenterPlacementActions,
  AgentCenterSession,
  AgentCenterSnapshot,
} from '../types.js';
import { translateAgentCenter } from '../i18n.js';
import { SectionHeader, SectionShell } from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterAIConfigSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
  readonly placementActions?: AgentCenterPlacementActions;
}

function aiConfigCopy(i18n: AgentCenterI18n | undefined): ModelConfigCopy {
  const t = (key: string, fallback: string) => translateAgentCenter(i18n, key, fallback);
  return {
    title: t('AgentCenter.aiConfig.sectionTitle', 'AI configuration'),
    description: t(
      'AgentCenter.aiConfig.capabilityConfigurationDescription',
      'Choose Local or Cloud capability intent. Runtime validates the committed implementation when execution starts.',
    ),
    backLabel: t('AgentCenter.aiConfig.backLabel', 'All capabilities'),
    detailTitle: (capabilityLabel: string) => translateAgentCenter(
      i18n,
      'AgentCenter.aiConfig.detailTitle',
      '{{capability}} Configuration',
      { capability: capabilityLabel },
    ),
    activeModelLabel: t('AgentCenter.aiConfig.activeModelLabel', 'Active Model'),
    activeModelHint: t('AgentCenter.aiConfig.activeModelHint', 'Click to change model'),
    activeModelConfiguredLabel: t('AgentCenter.aiConfig.activeModelConfiguredLabel', 'configured'),
    activeModelSetupPendingLabel: t('AgentCenter.aiConfig.activeModelSetupPendingLabel', 'setup pending'),
    modelPickerTitle: t('AgentCenter.aiConfig.modelPickerTitle', 'Select Model'),
    modelPickerSearchPlaceholder: t('AgentCenter.aiConfig.modelPickerSearch', 'Search models'),
    modelPickerLoadingLabel: t('AgentCenter.aiConfig.modelPickerLoading', 'Loading models…'),
    modelPickerEmptyLabel: t('AgentCenter.aiConfig.modelPickerEmpty', 'No models are available for this capability.'),
    routeLabel: t('AgentCenter.aiConfig.routeLabel', 'Execution intent'),
    localLabel: t('AgentCenter.aiConfig.localIntentLabel', 'Local'),
    cloudLabel: t('AgentCenter.aiConfig.cloudIntentLabel', 'Cloud'),
    saveLocalLabel: t('AgentCenter.aiConfig.configureLocalAction', 'Save Local intent'),
    saveCloudLabel: t('AgentCenter.aiConfig.cloudSaveAction', 'Save Cloud intent'),
    savingLabel: t('AgentCenter.aiConfig.savingLabel', 'Saving…'),
    advancedLabel: t('AgentCenter.aiConfig.advancedLabel', 'Advanced intent'),
    advancedHint: t(
      'AgentCenter.aiConfig.advancedHint',
      'Required features and default parameters apply to this shared LocalAgent AIConfig intent.',
    ),
    requiredFeaturesLabel: t('AgentCenter.aiConfig.requiredFeaturesLabel', 'Required features'),
    requiredFeaturesPlaceholder: t(
      'AgentCenter.aiConfig.requiredFeaturesPlaceholder',
      'Comma-separated CapabilityContract features',
    ),
    defaultsLabel: t('AgentCenter.aiConfig.defaultsLabel', 'Default parameters'),
    defaultsPlaceholder: t('AgentCenter.aiConfig.defaultsPlaceholder', 'Leave a field empty to keep that parameter unset.'),
    defaultsUnsetLabel: t('AgentCenter.aiConfig.defaultsUnsetLabel', 'Not set'),
    defaultsTrueLabel: t('AgentCenter.aiConfig.defaultsTrueLabel', 'True'),
    defaultsFalseLabel: t('AgentCenter.aiConfig.defaultsFalseLabel', 'False'),
    defaultsListPlaceholder: t('AgentCenter.aiConfig.defaultsListPlaceholder', 'One value per line'),
    defaultsLocalEffectivePlaceholder: (value: string) => translateAgentCenter(
      i18n,
      'AgentCenter.aiConfig.defaultsLocalEffectivePlaceholder',
      'Not set · Engine default {{value}}',
      { value },
    ),
    defaultsCloudEffectivePlaceholder: t(
      'AgentCenter.aiConfig.defaultsCloudEffectivePlaceholder',
      'Not set · Provider decides',
    ),
    defaultsRandomValue: t('AgentCenter.aiConfig.defaultsRandomValue', 'random'),
    localChoiceDescription: t(
      'AgentCenter.aiConfig.localChoiceDescription',
      'Use the model selected in Loadouts.',
    ),
    localSelectedLabel: t('AgentCenter.aiConfig.localSelectedLabel', 'Selected on this machine'),
    localMissingLabel: t(
      'AgentCenter.aiConfig.localMissingLabel',
      'Local intent is saved, but this machine has no selected configuration for this capability.',
    ),
    localBrokenLabel: t(
      'AgentCenter.aiConfig.localBrokenLabel',
      'The selected machine configuration is blocked:',
    ),
    localUnavailableLabel: t(
      'AgentCenter.aiConfig.localUnavailableLabel',
      'Machine-local configuration status is currently unavailable.',
    ),
    localMismatchLabel: (features: string) => translateAgentCenter(
      i18n,
      'AgentCenter.aiConfig.localMismatchLabel',
      'The selected machine configuration does not provide required features: {{features}}',
      { features },
    ),
    openMachineLabel: t('AgentCenter.aiConfig.openMachineLabel', 'Open Loadouts'),
    cloudConnectorPickerLabel: t('AgentCenter.aiConfig.cloudConnectorPickerLabel', 'Cloud Connector'),
    cloudConnectorPickerPlaceholder: t(
      'AgentCenter.aiConfig.cloudConnectorPickerPlaceholder',
      'Select a configured Connector',
    ),
    cloudConnectorSelectionRequired: t(
      'AgentCenter.aiConfig.cloudConnectorSelectionRequired',
      'Select a configured Connector before choosing a model.',
    ),
    cloudNoConnectorsLabel: t(
      'AgentCenter.aiConfig.cloudNoConnectorsLabel',
      'No configured Cloud Connector is available.',
    ),
    openCloudConnectorsLabel: t(
      'AgentCenter.aiConfig.openCloudConnectorsLabel',
      'Configure Cloud Connectors',
    ),
    cloudImplementationLabel: t('AgentCenter.aiConfig.cloudImplementationLabel', 'Cloud implementation'),
    cloudImplementationPlaceholder: t(
      'AgentCenter.aiConfig.cloudImplementationPlaceholder',
      'Choose an existing implementation',
    ),
    cloudTargetLabel: t('AgentCenter.aiConfig.cloudTargetLabel', 'Provider-model target'),
    cloudTargetPlaceholder: t('AgentCenter.aiConfig.cloudTargetPlaceholder', 'Choose an existing target'),
    cloudTargetDialogTitle: t('AgentCenter.aiConfig.cloudTargetDialogTitle', 'Choose a Cloud target'),
    cloudTargetDialogDescription: t(
      'AgentCenter.aiConfig.cloudTargetDialogDescription',
      'Review the provider-model details, then confirm the target explicitly.',
    ),
    cloudTargetConfirmation: t(
      'AgentCenter.aiConfig.cloudTargetConfirmation',
      'I confirm this implementation and provider-model target.',
    ),
    cloudAuthorizationLabel: t('AgentCenter.aiConfig.cloudAuthorizationLabel', 'Cloud execution route'),
    cloudAuthorizationNone: t('AgentCenter.aiConfig.cloudAuthorizationNone', 'Current Nimi account'),
    cloudConnectorLabel: t('AgentCenter.aiConfig.cloudConnectorLabel', 'Configured Connector'),
    cloudConnectorPlaceholder: t(
      'AgentCenter.aiConfig.cloudConnectorPlaceholder',
      'Choose a connector for this provider',
    ),
    cloudAuthorizationSeparation: t(
      'AgentCenter.aiConfig.cloudAuthorizationSeparation',
      'Nimi resolves the current-account Connector and credential at execution time.',
    ),
    cloudAccountLabel: (account: string) => translateAgentCenter(
      i18n,
      'AgentCenter.aiConfig.cloudAccountLabel',
      'Account: {{account}}',
      { account },
    ),
    cloudImpactSharedLabel: (account: string) => translateAgentCenter(
      i18n,
      'AgentCenter.aiConfig.cloudSharedScopeConfirmation',
      'I understand this choice applies to every LocalAgent and proactive task, may send data off this machine, use account {{account}}, and incur provider cost.',
      { account },
    ),
    cloudLoadFailed: t('AgentCenter.aiConfig.cloudLoadFailed', 'Cloud configuration choices could not be loaded.'),
    retryLabel: t('AgentCenter.common.retryLabel', 'Retry'),
    loadFailed: t('AgentCenter.aiConfig.loadFailedLabel', 'AIConfig could not be loaded.'),
    saveFailed: t('AgentCenter.aiConfig.saveFailedLabel', 'Could not save AIConfig.'),
    technicalDetailsLabel: t('AgentCenter.aiConfig.technicalDetailsLabel', 'Technical details'),
    unsupportedCapabilityLabel: t(
      'AgentCenter.aiConfig.unsupportedCapabilityLabel',
      'This capability is not admitted by the canonical Kit catalog.',
    ),
    notConfiguredLabel: t('AgentCenter.aiConfig.notConfiguredLabel', 'Not configured'),
    configuredLabel: t('AgentCenter.aiConfig.configuredLabel', 'Configured'),
    selectionRequiredLabel: t('AgentCenter.aiConfig.selectionRequiredLabel', 'Selection required'),
    blockedLabel: t('AgentCenter.aiConfig.blockedLabel', 'Blocked'),
    mismatchLabel: t('AgentCenter.aiConfig.mismatchLabel', 'Feature mismatch'),
    cancelLabel: t('AgentCenter.aiConfig.cloudCancelAction', 'Cancel'),
    confirmSelectionLabel: t('AgentCenter.aiConfig.confirmSelectionLabel', 'Use this target'),
    capabilityLabel: (capabilityContract: string, fallback: string) => translateAgentCenter(
      i18n,
      `AgentCenter.capability.${capabilityContract}.label`,
      fallback,
    ),
    capabilityDescription: (capabilityContract: string, fallback: string) => translateAgentCenter(
      i18n,
      `AgentCenter.capability.${capabilityContract}.description`,
      fallback,
    ),
  };
}

export function AgentCenterAIConfigSection({
  session,
  snapshot,
  i18n,
  placementActions,
}: AgentCenterAIConfigSectionProps) {
  const availability = snapshot.availability.overwriteSharedAIConfig;
  const copy = useMemo(() => aiConfigCopy(i18n), [i18n]);

  if (availability.state === 'unavailable') {
    return (
      <SectionShell labelledBy="agent-center-ai-config-title">
        <SectionHeader
          id="agent-center-ai-config-title"
          title={copy.title || 'AI configuration'}
          description={copy.description}
        />
        <AgentCenterProductActionNotice
          action="overwriteSharedAIConfig"
          availability={availability}
          i18n={i18n}
          session={session}
        />
      </SectionShell>
    );
  }

  return (
    <SectionShell labelledBy="agent-center-ai-config-title">
      <ModelConfigAIConfigSurface
        titleId="agent-center-ai-config-title"
        context={{ owner: 'shared-local-agent-ai-config', consumer: 'nimi-first-party' }}
        capabilityContracts={['text.generate', 'audio.transcribe']}
        capabilities={snapshot.state.sharedAIConfig?.aiConfig.capabilities ?? null}
        disabled={snapshot.state.agentAIConfigMutationDisabledReason !== null}
        localSelections={snapshot.state.localSelections}
        cloudAIConfig={session.cloudAIConfig}
        onOverwrite={(capabilities) => session.overwriteSharedAIConfig({ capabilities })}
        onOpenMachineLoadout={placementActions?.openMachineLoadout}
        onOpenCloudConnectorConfiguration={placementActions?.openCloudConnectorConfiguration}
        formatError={(error) => ({
          message: copy.saveFailed || 'Could not save AIConfig.',
          technicalDetail: error instanceof Error ? error.message : String(error),
        })}
        copy={copy}
      />
    </SectionShell>
  );
}
