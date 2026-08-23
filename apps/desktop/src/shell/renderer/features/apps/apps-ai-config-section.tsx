import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  CANONICAL_CAPABILITY_IDS,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  createNimiLocalAIConfigCapabilityIntent,
  type NimiPortableAppAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCopy,
} from '@nimiplatform/kit/features/model-config';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import {
  useDesktopNimiAppAIConfig,
  useOverwriteDesktopNimiAppAIConfig,
} from '../chat/chat-nimi-app-ai-config.js';

export const APPS_AI_CONFIG_APP_ACCESS_DOMAIN = 'runtime.consume';

export function buildAppsOneClickLocalAIConfig(
  current: readonly NimiPortableAppAIConfigIntent[],
  machineSelectedCapabilities: readonly string[],
): readonly NimiPortableAppAIConfigIntent[] {
  const canonical = new Set<string>(CANONICAL_CAPABILITY_IDS);
  const selected = new Set(machineSelectedCapabilities.filter((entry) => canonical.has(entry)));
  const seen = new Set<string>();
  const next = current.map((intent) => {
    seen.add(intent.capabilityContract);
    if (!selected.has(intent.capabilityContract)) return intent;
    return {
      ...intent,
      route: { oneofKind: 'local' as const, local: {} },
    };
  });
  for (const capabilityContract of CANONICAL_CAPABILITY_IDS) {
    if (!selected.has(capabilityContract) || seen.has(capabilityContract)) continue;
    next.push(createNimiLocalAIConfigCapabilityIntent({ capabilityContract }));
  }
  return next;
}

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
    clearLabel: t('Chat.settingsClearIntent', { defaultValue: 'Clear configuration' }),
    clearingLabel: t('Chat.settingsClearingIntent', { defaultValue: 'Clearing…' }),
    conflictLabel: t('Chat.settingsConfigConflict', { defaultValue: 'Configuration changed elsewhere' }),
    conflictDescription: t('Chat.settingsConfigConflictDescription', {
      defaultValue: 'Your draft was kept. Review the current configuration, then save again to replace it.',
    }),
    conflictCurrentLabel: (revision: string, summary: string) => t('Chat.settingsConfigConflictCurrent', {
      defaultValue: 'Current revision {{revision}}: {{summary}}', revision, summary,
    }),
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
    cloudNoticeLabel: t('Chat.settingsCloudExecutionRoute', { defaultValue: 'Cloud execution' }),
    cloudNoticeDescription: t('Chat.settingsCloudConnectorResolution', {
      defaultValue: 'Requests may leave this device and incur provider charges.',
    }),
    cloudConnectorLabel: t('Chat.settingsCloudConnector', { defaultValue: 'Configured Connector' }),
    cloudConnectorPlaceholder: t('Chat.settingsCloudConnectorPlaceholder', {
      defaultValue: 'Choose a connector for this provider',
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
    unavailableLabel: t('Chat.settingsModelUnavailable', { defaultValue: 'Unavailable' }),
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
  readonly allowedRoutes: readonly ('local' | 'cloud')[];
  readonly onAIConfigChanged: () => void;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r102
export function AppsAIConfigSection({
  appId,
  appDisplayName,
  allowedRoutes,
  onAIConfigChanged,
}: AppsAIConfigSectionProps) {
  const { t } = useTranslation();
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const sdk = useDesktopRendererSdk();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const appAIConfig = useDesktopNimiAppAIConfig(appId);
  const overwriteAppAIConfig = useOverwriteDesktopNimiAppAIConfig(appId);
  const copy = useAppsModelConfigCopy(appDisplayName);
  const [oneClickFailure, setOneClickFailure] = useState<'conflict' | 'failed' | null>(null);
  const overwriteAndRefreshSummary = useCallback(async (
    input: Parameters<typeof overwriteAppAIConfig.mutateAsync>[0],
  ) => {
    const result = await overwriteAppAIConfig.mutateAsync(input);
    onAIConfigChanged();
    return result;
  }, [onAIConfigChanged, overwriteAppAIConfig]);
  const machineSelections = useQuery({
    queryKey: ['desktop', 'machine-local-ai-config-selections'],
    queryFn: async () => {
      const manager = sdk.accountProduct().appAIConfig(appId);
      const selections = await Promise.all(CANONICAL_CAPABILITY_IDS.map(async (capabilityContract) => {
        const result = await manager.listOptions({ kind: 'local-loadouts', capabilityContract });
        if (result.kind !== 'local-loadouts') throw new Error('Runtime returned mismatched Local selection projection.');
        return result.options.length > 0 ? capabilityContract : null;
      }));
      return selections.filter((entry): entry is string => entry !== null);
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
  const openMachineLoadout = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.focusAction({
      page: 'loadouts',
      action: 'open-loadouts',
      focus: 'runtime-config-action-focus.loadouts',
    });
  }, [runtimeConfigNavigation, setActiveTab]);

  return (
    <section data-testid={`apps-ai-config-${appId}`}>
      <ModelConfigAIConfigSurface
        context={{ owner: 'app-ai-config', appId }}
        capabilityContracts={CANONICAL_CAPABILITY_IDS}
        allowedRoutes={allowedRoutes}
        capabilities={appAIConfig.data?.config?.capabilities ?? (appAIConfig.isPending ? undefined : null)}
        revision={appAIConfig.data?.revision}
        effectiveSelections={appAIConfig.data?.effectiveSelections}
        listOptions={(query) => sdk.accountProduct().appAIConfig(appId).listOptions(query)}
        loading={appAIConfig.isPending}
        loadError={appAIConfig.isError ? copy.loadFailed : null}
        onRetry={() => { void appAIConfig.refetch(); }}
        onOverwrite={overwriteAndRefreshSummary}
        onOpenMachineLoadout={openMachineLoadout}
        formatError={(error) => ({
          message: copy.saveFailed || 'Runtime could not save this app\'s AI configuration.',
          technicalDetail: error instanceof Error ? error.message : String(error || ''),
        })}
        copy={copy}
        headerSlot={allowedRoutes.includes('local') ? (
          <div className="space-y-2" data-testid="apps-ai-config-one-click-local">
            <Button
              tone="secondary"
              disabled={machineSelections.isPending || machineSelections.isFetching || machineSelections.isError
                || (machineSelections.data?.length ?? 0) === 0
                || appAIConfig.data?.revision === undefined
                || overwriteAppAIConfig.isPending}
              loading={machineSelections.isPending || machineSelections.isFetching || overwriteAppAIConfig.isPending}
              onClick={() => {
                setOneClickFailure(null);
                void Promise.all([
                  machineSelections.refetch(),
                  appAIConfig.refetch(),
                ]).then(async ([freshSelections, freshConfig]) => {
                  if (freshSelections.isError || freshConfig.isError) {
                    setOneClickFailure('failed');
                    return;
                  }
                  const revision = freshConfig.data?.revision;
                  const selectedCapabilities = freshSelections.data ?? [];
                  if (revision === undefined || selectedCapabilities.length === 0) return;
                  const result = await overwriteAndRefreshSummary({
                    expectedRevision: revision,
                    capabilities: buildAppsOneClickLocalAIConfig(
                      freshConfig.data?.config?.capabilities ?? [],
                      selectedCapabilities,
                    ),
                  });
                  if (result.outcome === 'conflict') setOneClickFailure('conflict');
                }).catch(() => setOneClickFailure('failed'));
              }}
            >
              {machineSelections.isPending
                ? t('Apps.aiConfig.oneClickLoading')
                : t('Apps.aiConfig.oneClickLabel')}
            </Button>
            <p className="m-0 text-xs text-[var(--nimi-text-muted)]">{t('Apps.aiConfig.oneClickHint')}</p>
            {machineSelections.isError ? (
              <InlineAlert tone="warning">{t('Apps.aiConfig.oneClickUnavailable')}</InlineAlert>
            ) : null}
            {!machineSelections.isPending && !machineSelections.isError && machineSelections.data?.length === 0 ? (
              <InlineAlert tone="warning">{t('Apps.aiConfig.oneClickNoLocalModels')}</InlineAlert>
            ) : null}
            {oneClickFailure === 'conflict' ? (
              <InlineAlert tone="warning">{copy.conflictLabel}: {copy.conflictDescription}</InlineAlert>
            ) : null}
            {oneClickFailure === 'failed' ? (
              <InlineAlert tone="danger">{t('Apps.aiConfig.oneClickFailed')}</InlineAlert>
            ) : null}
          </div>
        ) : undefined}
      />
    </section>
  );
}
