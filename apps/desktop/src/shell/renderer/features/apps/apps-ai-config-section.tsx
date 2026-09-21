import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CANONICAL_CAPABILITY_IDS,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  type NimiAIConfigOverwriteResult,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCapabilitySection,
  type ModelConfigCopy,
} from '@nimiplatform/kit/features/model-config';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import {
  useDesktopNimiAppAIConfig,
  useOverwriteDesktopNimiAppAIConfig,
} from '../chat/chat-nimi-app-ai-config.js';
import {
  getRuntimeSetupTaskStore,
} from '../runtime-config/runtime-setup-task-store.js';
import {
  openOrCreateRuntimeSetupTask,
} from '../runtime-config/runtime-setup-task-open.js';
import {
  currentDesktopAccountIdForSetup,
} from '../runtime-config/runtime-setup-task-ports.js';

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
  'audio.separate': {
    label: 'Apps.aiConfig.capability.audioSeparate.label',
    description: 'Apps.aiConfig.capability.audioSeparate.description',
  },
  'image.generate': {
    label: 'Apps.aiConfig.capability.imageGenerate.label',
    description: 'Apps.aiConfig.capability.imageGenerate.description',
  },
  'music.generate': {
    label: 'Apps.aiConfig.capability.musicGenerate.label',
    description: 'Apps.aiConfig.capability.musicGenerate.description',
  },
  'music.transcribe': {
    label: 'Apps.aiConfig.capability.musicTranscribe.label',
    description: 'Apps.aiConfig.capability.musicTranscribe.description',
  },
  'text.embed': {
    label: 'Apps.aiConfig.capability.textEmbed.label',
    description: 'Apps.aiConfig.capability.textEmbed.description',
  },
  'text.annotate': {
    label: 'Apps.aiConfig.capability.textAnnotate.label',
    description: 'Apps.aiConfig.capability.textAnnotate.description',
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
  'image.face_swap': {
    label: 'Apps.aiConfig.capability.imageFaceSwap.label',
    description: 'Apps.aiConfig.capability.imageFaceSwap.description',
  },
  'video.face_swap': {
    label: 'Apps.aiConfig.capability.videoFaceSwap.label',
    description: 'Apps.aiConfig.capability.videoFaceSwap.description',
  },
  'realtime.interact': {
    label: 'Apps.aiConfig.capability.realtimeInteract.label',
    description: 'Apps.aiConfig.capability.realtimeInteract.description',
  },
  'vision.locate': {
    label: 'Apps.aiConfig.capability.visionLocate.label',
    description: 'Apps.aiConfig.capability.visionLocate.description',
  },
});

export function appsAIConfigCapabilityContracts(
  appAccess: readonly string[],
): readonly string[] {
  return appAccess.includes(APPS_AI_CONFIG_APP_ACCESS_DOMAIN)
    ? CANONICAL_CAPABILITY_IDS
    : [];
}

export type AppsAIConfigCapabilitySectionPlan = {
  /** Canonical capabilities the App declares in capability_contract_refs. */
  readonly declared: readonly string[];
  /** Saved per-app intents outside the declared set, including non-canonical contracts. */
  readonly configuredOthers: readonly string[];
  /** Everything else; collapsed by default unless it is the only group. */
  readonly rest: readonly string[];
};

/**
 * Presentation grouping for the Apps AI models tab: declared capabilities
 * first, saved overrides visible, the remaining catalog out of the way, all
 * in canonical catalog order. Pure presentation; editing scope is unchanged.
 */
export function partitionAppsAIConfigCapabilities(input: {
  readonly declaredRefs: readonly string[];
  readonly configuredContracts: readonly string[];
}): AppsAIConfigCapabilitySectionPlan {
  const declaredRefs = new Set(input.declaredRefs.map((entry) => entry.trim()).filter(Boolean));
  const configured = new Set(input.configuredContracts.map((entry) => entry.trim()).filter(Boolean));
  const declared: string[] = [];
  const configuredOthers: string[] = [];
  const rest: string[] = [];
  for (const contract of CANONICAL_CAPABILITY_IDS) {
    if (declaredRefs.has(contract)) declared.push(contract);
    else if (configured.has(contract)) configuredOthers.push(contract);
    else rest.push(contract);
  }
  for (const contract of configured) {
    if (!CANONICAL_CAPABILITY_IDS.includes(contract)) configuredOthers.push(contract);
  }
  return { declared, configuredOthers, rest };
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
  /** App-declared capability_contract_refs; empty means the App declares none. */
  readonly declaredCapabilityRefs?: readonly string[];
  readonly onAIConfigChanged: (result: NimiAIConfigOverwriteResult) => void;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r102
export function AppsAIConfigSection({
  appId,
  appDisplayName,
  allowedRoutes,
  declaredCapabilityRefs = [],
  onAIConfigChanged,
}: AppsAIConfigSectionProps) {
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const sdk = useDesktopRendererSdk();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const appAIConfig = useDesktopNimiAppAIConfig(appId);
  const overwriteAppAIConfig = useOverwriteDesktopNimiAppAIConfig(appId);
  const { t, i18n } = useTranslation();
  const copy = useAppsModelConfigCopy(appDisplayName);
  const capabilities = appAIConfig.data?.config?.capabilities ?? (appAIConfig.isPending ? undefined : null);
  const capabilitySections = useMemo<readonly ModelConfigCapabilitySection[] | undefined>(() => {
    if (capabilities === undefined) return undefined;
    const plan = partitionAppsAIConfigCapabilities({
      declaredRefs: declaredCapabilityRefs,
      configuredContracts: (capabilities ?? []).map((entry) => entry.capabilityContract),
    });
    const sections: ModelConfigCapabilitySection[] = [];
    if (plan.declared.length > 0) {
      sections.push({
        id: 'declared',
        title: t('Apps.aiConfig.sections.declared', {
          count: plan.declared.length,
          defaultValue: 'Required by this app ({{count}})',
        }),
        contracts: plan.declared,
        collapsible: false,
      });
    }
    if (plan.configuredOthers.length > 0) {
      sections.push({
        id: 'configured-others',
        title: t('Apps.aiConfig.sections.configuredOthers', {
          count: plan.configuredOthers.length,
          defaultValue: 'Other configured capabilities ({{count}})',
        }),
        contracts: plan.configuredOthers,
        collapsible: false,
      });
    }
    if (plan.rest.length > 0) {
      sections.push({
        id: 'rest',
        title: t('Apps.aiConfig.sections.rest', {
          count: plan.rest.length,
          defaultValue: 'All capabilities ({{count}})',
        }),
        contracts: plan.rest,
        defaultExpanded: plan.declared.length === 0 && plan.configuredOthers.length === 0,
      });
    }
    return sections;
  }, [capabilities, declaredCapabilityRefs, t]);
  const overwriteAndRefreshSummary = useCallback(async (
    input: Parameters<typeof overwriteAppAIConfig.mutateAsync>[0],
  ) => {
    const result = await overwriteAppAIConfig.mutateAsync(input);
    onAIConfigChanged(result);
    return result;
  }, [onAIConfigChanged, overwriteAppAIConfig]);
  const openMachineLoadout = useCallback((capabilityContract: string) => {
    // Consumer entries open the shared setup task with the exact owner,
    // account snapshot, and return handle; the task view owns the route from
    // here and never re-sends app input.
    void currentDesktopAccountIdForSetup().then((accountId) => {
      openOrCreateRuntimeSetupTask(getRuntimeSetupTaskStore(), {
        capabilityContract,
        source: {
          kind: 'app',
          ownerAppId: appId,
          accountId,
          returnFocus: `apps:${appId}`,
        },
        openTask: (taskId) => {
          setActiveTab('runtime');
          runtimeConfigNavigation.openSetupTask(taskId);
        },
      });
    });
  }, [appId, runtimeConfigNavigation, setActiveTab]);

  const openProfileUse = useCallback(() => {
    // The profile library opens in this app's owner context: the selected
    // capabilities prepare on this machine and the app routes save once.
    setActiveTab('runtime');
    runtimeConfigNavigation.openProfileUse({
      kind: 'app',
      ownerAppId: appId,
      returnFocus: `apps:${appId}`,
    });
  }, [appId, runtimeConfigNavigation, setActiveTab]);

  return (
    <section data-testid={`apps-ai-config-${appId}`}>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          data-testid={`apps-ai-config-use-profile:${appId}`}
          onClick={openProfileUse}
          className="text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-bg)] hover:underline"
        >
          {t('Apps.aiConfig.useProfile', { defaultValue: 'Use a profile' })}
        </button>
      </div>
      <ModelConfigAIConfigSurface
        context={{ owner: 'app-ai-config', appId }}
        capabilityContracts={CANONICAL_CAPABILITY_IDS}
        capabilitySections={capabilitySections}
        allowedRoutes={allowedRoutes}
        capabilities={appAIConfig.data?.config?.capabilities ?? (appAIConfig.isPending ? undefined : null)}
        revision={appAIConfig.data?.revision}
        effectiveSelections={appAIConfig.data?.effectiveSelections}
        listOptions={(query) => (
          appId === sdk.appId() ? sdk.appProduct().aiConfig : sdk.accountProduct().appAIConfig(appId)
        ).listOptions(query)}
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
        language={i18n.resolvedLanguage || i18n.language}
        showTitle={false}
      />
    </section>
  );
}
