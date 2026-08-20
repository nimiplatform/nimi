import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiCapabilityAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import {
  CANONICAL_CAPABILITY_IDS,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCopy,
  type ModelConfigLocalSelectionProjection,
} from '@nimiplatform/kit/features/model-config';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import { createDesktopCloudAIConfigModule } from '../chat/chat-cloud-ai-config-module.js';
import {
  useDesktopNimiAppAIConfig,
  useDesktopNimiMachineLocalSelections,
  useOverwriteDesktopNimiAppAIConfig,
} from '../chat/chat-nimi-app-ai-config.js';

export const APPS_AI_CONFIG_APP_ACCESS_DOMAIN = 'runtime.consume';

const CAPABILITY_COPY_KEYS: Readonly<Record<string, {
  readonly label: string;
  readonly description: string;
}>> = Object.freeze({
  'audio.synthesize': {
    label: 'Apps.aiConfig.capability.audioSynthesize.label',
    description: 'Apps.aiConfig.capability.audioSynthesize.description',
  },
  'audio.transcribe': {
    label: 'Apps.aiConfig.capability.audioTranscribe.label',
    description: 'Apps.aiConfig.capability.audioTranscribe.description',
  },
  'image.generate': {
    label: 'Apps.aiConfig.capability.imageGenerate.label',
    description: 'Apps.aiConfig.capability.imageGenerate.description',
  },
  'music.generate': {
    label: 'Apps.aiConfig.capability.musicGenerate.label',
    description: 'Apps.aiConfig.capability.musicGenerate.description',
  },
  'text.embed': {
    label: 'Apps.aiConfig.capability.textEmbed.label',
    description: 'Apps.aiConfig.capability.textEmbed.description',
  },
  'text.generate': {
    label: 'Apps.aiConfig.capability.textGenerate.label',
    description: 'Apps.aiConfig.capability.textGenerate.description',
  },
  'video.generate': {
    label: 'Apps.aiConfig.capability.videoGenerate.label',
    description: 'Apps.aiConfig.capability.videoGenerate.description',
  },
  'voice.create': {
    label: 'Apps.aiConfig.capability.voiceCreate.label',
    description: 'Apps.aiConfig.capability.voiceCreate.description',
  },
  'world.generate': {
    label: 'Apps.aiConfig.capability.worldGenerate.label',
    description: 'Apps.aiConfig.capability.worldGenerate.description',
  },
});

export function appsAIConfigCapabilityContracts(
  appAccess: readonly string[],
): readonly string[] {
  return appAccess.includes(APPS_AI_CONFIG_APP_ACCESS_DOMAIN)
    ? CANONICAL_CAPABILITY_IDS
    : [];
}

function unavailableLocalSelections(): readonly ModelConfigLocalSelectionProjection[] {
  return CANONICAL_CAPABILITY_IDS.map((capabilityContract) => ({
    capabilityContract,
    state: 'unavailable',
    loadoutId: null,
    displayName: null,
    supportedFeatures: [],
    reasons: [],
  }));
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-model-config-001
export function buildAppsOneClickLocalAIConfig(
  capabilityContracts: readonly string[],
  currentCapabilities: readonly NimiCapabilityAIConfigIntent[],
  localSelections: readonly ModelConfigLocalSelectionProjection[],
): readonly NimiCapabilityAIConfigIntent[] | null {
  const orderedContracts = [...new Set(capabilityContracts)];
  const requestedContracts = new Set(orderedContracts);
  const selectedLocalContracts = new Set(
    localSelections
      .filter((selection) => (
        selection.state === 'selected'
        && requestedContracts.has(selection.capabilityContract)
      ))
      .map((selection) => selection.capabilityContract),
  );
  if (selectedLocalContracts.size === 0) return null;

  const currentByContract = new Map(
    currentCapabilities.map((capability) => [capability.capabilityContract, capability]),
  );
  const configured = orderedContracts.flatMap((capabilityContract) => {
    const current = currentByContract.get(capabilityContract);
    if (!selectedLocalContracts.has(capabilityContract)) return current ? [current] : [];
    const defaults = runtimeAIConfigStructToJson(current?.defaults);
    return [createNimiLocalAIConfigCapabilityIntent({
      capabilityContract,
      requiredFeatures: current?.requiredFeatures ?? [],
      ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
    })];
  });
  return configured.concat(
    currentCapabilities.filter((capability) => !requestedContracts.has(capability.capabilityContract)),
  );
}

function useAppsModelConfigCopy(appDisplayName: string): ModelConfigCopy {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t('Apps.aiConfig.title', { defaultValue: 'AI models' }),
    description: t('Apps.aiConfig.description', {
      defaultValue: 'Choose the Local or Cloud implementation Nimi uses when this app calls an AI capability.',
    }),
    backLabel: t('Chat.settingsModelConfigBack', { defaultValue: 'Back' }),
    detailTitle: (capabilityLabel: string) => t('Chat.settingsModelConfigTitle', {
      defaultValue: '{{capability}} Configuration',
      capability: capabilityLabel,
    }),
    activeModelLabel: t('Chat.settingsActiveModel', { defaultValue: 'Active Model' }),
    activeModelHint: t('Chat.settingsActiveModelHint', { defaultValue: 'Click to change model' }),
    activeModelConfiguredLabel: t('Chat.settingsModelConfigured', { defaultValue: 'configured' }),
    activeModelSetupPendingLabel: t('Chat.settingsModelSetupPending', { defaultValue: 'setup pending' }),
    modelPickerTitle: t('Chat.settingsModelPickerTitle', { defaultValue: 'Select Model' }),
    modelPickerSearchPlaceholder: t('Chat.settingsModelPickerSearch', { defaultValue: 'Search models' }),
    modelPickerLoadingLabel: t('Chat.settingsModelPickerLoading', { defaultValue: 'Loading models…' }),
    modelPickerEmptyLabel: t('Chat.settingsModelPickerEmpty', {
      defaultValue: 'No models are available for this capability.',
    }),
    configuredSummary: t('Apps.aiConfig.configuredSummary', {
      defaultValue: 'Model settings complete',
    }),
    emptySummary: t('Apps.aiConfig.emptySummary', { defaultValue: 'No model selected' }),
    routeLabel: t('Chat.settingsExecutionIntent', { defaultValue: 'Execution intent' }),
    localLabel: t('Chat.settingsIntentLocal', { defaultValue: 'Local' }),
    cloudLabel: t('Chat.settingsIntentCloud', { defaultValue: 'Cloud' }),
    saveLocalLabel: t('Chat.settingsSaveIntent', { defaultValue: 'Save intent' }),
    saveCloudLabel: t('Chat.settingsSaveIntent', { defaultValue: 'Save intent' }),
    savingLabel: t('Chat.settingsSavingIntent', { defaultValue: 'Saving…' }),
    advancedLabel: t('Chat.settingsAdvanced', { defaultValue: 'Advanced intent' }),
    advancedHint: t('Chat.settingsAdvancedHint', {
      defaultValue: 'Required features and default parameters travel with this App AIConfig intent.',
    }),
    requiredFeaturesLabel: t('Chat.settingsRequiredFeatures', { defaultValue: 'Required features' }),
    requiredFeaturesPlaceholder: t('Chat.settingsRequiredFeaturesPlaceholder', {
      defaultValue: 'Comma-separated CapabilityContract features',
    }),
    defaultsLabel: t('Chat.settingsPortableDefaults', { defaultValue: 'Default parameters' }),
    defaultsPlaceholder: t('Chat.settingsPortableDefaultsPlaceholder', {
      defaultValue: 'Leave a field empty to keep that parameter unset.',
    }),
    defaultsUnsetLabel: t('Chat.settingsDefaultsUnset', { defaultValue: 'Not set' }),
    defaultsTrueLabel: t('Chat.settingsDefaultsTrue', { defaultValue: 'True' }),
    defaultsFalseLabel: t('Chat.settingsDefaultsFalse', { defaultValue: 'False' }),
    defaultsListPlaceholder: t('Chat.settingsDefaultsListPlaceholder', { defaultValue: 'One value per line' }),
    defaultsLocalEffectivePlaceholder: (value: string) => t('Chat.settingsDefaultsLocalEffectivePlaceholder', {
      defaultValue: 'Not set · Engine default {{value}}',
      value,
    }),
    defaultsCloudEffectivePlaceholder: t('Chat.settingsDefaultsCloudEffectivePlaceholder', {
      defaultValue: 'Not set · Provider decides',
    }),
    defaultsRandomValue: t('Chat.settingsDefaultsRandomValue', { defaultValue: 'random' }),
    localChoiceDescription: t('Chat.settingsLocalChoiceDescription', {
      defaultValue: 'Use the model selected in Loadouts.',
    }),
    localSelectedLabel: t('Chat.settingsLocalSelectionSelected', { defaultValue: 'Selected on this machine' }),
    localMissingLabel: t('Chat.settingsLocalSelectionMissing', {
      defaultValue: 'Local intent is saved, but this machine has no selected configuration for this capability.',
    }),
    localBrokenLabel: t('Chat.settingsLocalSelectionBroken', {
      defaultValue: 'The selected machine configuration is blocked:',
    }),
    localUnavailableLabel: t('Chat.settingsLocalSelectionUnavailable', {
      defaultValue: 'Machine-local configuration status is currently unavailable.',
    }),
    localMismatchLabel: (features: string) => t('Chat.settingsLocalSelectionMismatch', {
      defaultValue: 'The selected machine configuration does not provide required features: {{features}}',
      features,
    }),
    openMachineLabel: t('Chat.settingsOpenLocalConfigurations', {
      defaultValue: 'Open Loadouts',
    }),
    cloudConnectorPickerLabel: t('Chat.settingsCloudConnectorPicker', { defaultValue: 'Cloud Connector' }),
    cloudConnectorPickerPlaceholder: t('Chat.settingsCloudConnectorPickerPlaceholder', {
      defaultValue: 'Select a configured Connector',
    }),
    cloudConnectorSelectionRequired: t('Chat.settingsCloudConnectorSelectionRequired', {
      defaultValue: 'Select a configured Connector before choosing a model.',
    }),
    cloudNoConnectorsLabel: t('Chat.settingsCloudNoConnectors', {
      defaultValue: 'No configured Cloud Connector is available.',
    }),
    openCloudConnectorsLabel: t('Chat.settingsOpenCloudConnectors', {
      defaultValue: 'Configure Cloud Connectors',
    }),
    cloudImplementationLabel: t('Chat.settingsCloudImplementation', { defaultValue: 'Cloud implementation' }),
    cloudImplementationPlaceholder: t('Chat.settingsCloudImplementationPlaceholder', {
      defaultValue: 'Choose an existing implementation',
    }),
    cloudTargetLabel: t('Chat.settingsCloudTarget', { defaultValue: 'Provider-model target' }),
    cloudTargetPlaceholder: t('Chat.settingsCloudTargetPlaceholder', { defaultValue: 'Choose an existing target' }),
    cloudTargetDialogTitle: t('Chat.settingsCloudTargetDialogTitle', { defaultValue: 'Choose a Cloud target' }),
    cloudTargetDialogDescription: t('Chat.settingsCloudTargetDialogDescription', {
      defaultValue: 'Review the provider-model details, then confirm the target explicitly.',
    }),
    cloudTargetConfirmation: t('Chat.settingsCloudTargetConfirmation', {
      defaultValue: 'I confirm this implementation and provider-model target.',
    }),
    cloudAuthorizationLabel: t('Chat.settingsCloudExecutionRoute', { defaultValue: 'Cloud execution route' }),
    cloudAuthorizationNone: t('Chat.settingsCloudCurrentAccount', { defaultValue: 'Current Nimi account' }),
    cloudConnectorLabel: t('Chat.settingsCloudConnector', { defaultValue: 'Configured Connector' }),
    cloudConnectorPlaceholder: t('Chat.settingsCloudConnectorPlaceholder', {
      defaultValue: 'Choose a connector for this provider',
    }),
    cloudAuthorizationSeparation: t('Chat.settingsCloudConnectorResolution', {
      defaultValue: 'Nimi resolves the current-account Connector and credential at execution time.',
    }),
    cloudAccountLabel: (account: string) => t('Chat.settingsCloudAccount', {
      defaultValue: 'Account: {{account}}',
      account,
    }),
    cloudImpactAppLabel: (account: string) => t('Apps.aiConfig.cloudImpactConfirmation', {
      defaultValue: 'I understand {{app}} requests may leave this machine, use account {{account}}, and incur provider cost.',
      app: appDisplayName,
      account,
    }),
    cloudLoadFailed: t('Chat.settingsCloudChoicesLoadFailed', {
      defaultValue: 'Cloud implementation, target, or Connector choices could not be loaded.',
    }),
    retryLabel: t('Common.retry', { defaultValue: 'Retry' }),
    loadFailed: t('Apps.aiConfig.loadFailed', {
      defaultValue: 'This app\'s AI configuration could not be loaded from Runtime.',
    }),
    saveFailed: t('Apps.aiConfig.saveFailed', {
      defaultValue: 'Runtime could not save this app\'s AI configuration.',
    }),
    technicalDetailsLabel: t('Chat.settingsTechnicalDetails', { defaultValue: 'Technical details' }),
    unsupportedCapabilityLabel: t('Chat.settingsModelUnsupportedCapability', {
      defaultValue: 'This capability is unavailable.',
    }),
    notConfiguredLabel: t('Chat.settingsModelNotConfigured', { defaultValue: 'Not configured' }),
    configuredLabel: t('Chat.settingsModelConfigured', { defaultValue: 'Configured' }),
    selectionRequiredLabel: t('Chat.settingsModelSelectionRequired', { defaultValue: 'Selection required' }),
    blockedLabel: t('Chat.settingsModelBlocked', { defaultValue: 'Blocked' }),
    mismatchLabel: t('Chat.settingsModelFeatureMismatch', { defaultValue: 'Feature mismatch' }),
    cancelLabel: t('Chat.settingsModelPickerCancel', { defaultValue: 'Cancel' }),
    confirmSelectionLabel: t('Chat.settingsUseModelSelection', { defaultValue: 'Use selection' }),
    capabilityLabel: (capabilityContract: string, fallback: string) => {
      const key = CAPABILITY_COPY_KEYS[capabilityContract]?.label;
      return key ? t(key, { defaultValue: fallback }) : fallback;
    },
    capabilityDescription: (capabilityContract: string, fallback: string) => {
      const key = CAPABILITY_COPY_KEYS[capabilityContract]?.description;
      return key ? t(key, { defaultValue: fallback }) : fallback;
    },
  }), [appDisplayName, t]);
}

export interface AppsAIConfigSectionProps {
  readonly appId: string;
  readonly appDisplayName: string;
}

export function AppsAIConfigSection({
  appId,
  appDisplayName,
}: AppsAIConfigSectionProps) {
  const { t } = useTranslation();
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const sdk = useDesktopRendererSdk();
  const cloudAIConfig = useMemo(() => createDesktopCloudAIConfigModule(sdk), [sdk]);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const appAIConfig = useDesktopNimiAppAIConfig(appId);
  const machineSelections = useDesktopNimiMachineLocalSelections();
  const overwriteAppAIConfig = useOverwriteDesktopNimiAppAIConfig(appId);
  const copy = useAppsModelConfigCopy(appDisplayName);
  const [oneClickError, setOneClickError] = useState<string | null>(null);

  const localSelections = useMemo<readonly ModelConfigLocalSelectionProjection[]>(() => (
    machineSelections.data ?? unavailableLocalSelections()
  ), [machineSelections.data]);
  const hasSelectedLocalModels = localSelections.some((selection) => selection.state === 'selected');
  const oneClickCapabilities = useMemo(() => (
    appAIConfig.isSuccess && machineSelections.isSuccess
      ? buildAppsOneClickLocalAIConfig(
          CANONICAL_CAPABILITY_IDS,
          appAIConfig.data?.capabilities ?? [],
          localSelections,
        )
      : null
  ), [appAIConfig.data?.capabilities, appAIConfig.isSuccess, localSelections, machineSelections.isSuccess]);

  useEffect(() => setOneClickError(null), [appId]);

  const openMachineLoadout = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.focusAction({
      page: 'loadouts',
      action: 'open-loadouts',
      focus: 'runtime-config-action-focus.loadouts',
    });
  }, [runtimeConfigNavigation, setActiveTab]);

  const openCloudConnectorConfiguration = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.focusAction({
      page: 'cloud',
      action: 'add-connector',
      focus: 'runtime-config-action-focus.cloud-connector-draft',
    });
  }, [runtimeConfigNavigation, setActiveTab]);

  const applyLocalModels = useCallback(async () => {
    if (!oneClickCapabilities || overwriteAppAIConfig.isPending) return;
    setOneClickError(null);
    try {
      await overwriteAppAIConfig.mutateAsync(oneClickCapabilities);
    } catch {
      setOneClickError(t('Apps.aiConfig.oneClickFailed'));
    }
  }, [oneClickCapabilities, overwriteAppAIConfig, t]);

  const oneClickHint = machineSelections.isPending
    ? t('Apps.aiConfig.oneClickLoading')
    : machineSelections.isError
      ? t('Apps.aiConfig.oneClickUnavailable')
      : !hasSelectedLocalModels
        ? t('Apps.aiConfig.oneClickNoLocalModels')
        : t('Apps.aiConfig.oneClickHint');

  return (
    <section data-testid={`apps-ai-config-${appId}`}>
      <ModelConfigAIConfigSurface
        context={{ owner: 'app-ai-config', consumer: 'nimi-first-party', appId }}
        capabilityContracts={CANONICAL_CAPABILITY_IDS}
        capabilities={appAIConfig.data?.capabilities ?? (appAIConfig.isPending ? undefined : null)}
        localSelections={localSelections}
        cloudAIConfig={cloudAIConfig}
        loading={appAIConfig.isPending}
        loadError={appAIConfig.isError ? copy.loadFailed : null}
        onRetry={() => { void appAIConfig.refetch(); }}
        onOverwrite={async (capabilities) => {
          setOneClickError(null);
          await overwriteAppAIConfig.mutateAsync(capabilities);
        }}
        onOpenMachineLoadout={openMachineLoadout}
        onOpenCloudConnectorConfiguration={openCloudConnectorConfiguration}
        formatError={(error) => ({
          message: copy.saveFailed || 'Runtime could not save this app\'s AI configuration.',
          technicalDetail: error instanceof Error ? error.message : String(error || ''),
        })}
        copy={copy}
        headerSlot={(
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] px-3 py-2.5">
              <p className="m-0 min-w-0 flex-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">
                {oneClickHint}
              </p>
              <Button
                data-testid="apps-ai-config-one-click-local"
                size="sm"
                tone="secondary"
                loading={overwriteAppAIConfig.isPending}
                disabled={!oneClickCapabilities || overwriteAppAIConfig.isPending}
                onClick={() => { void applyLocalModels(); }}
              >
                {t('Apps.aiConfig.oneClickLabel')}
              </Button>
            </div>
            {oneClickError ? <InlineAlert tone="danger">{oneClickError}</InlineAlert> : null}
          </div>
        )}
      />
    </section>
  );
}
