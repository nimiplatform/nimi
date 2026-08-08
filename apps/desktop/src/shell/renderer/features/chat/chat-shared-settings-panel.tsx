import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineAlert, Surface } from '@nimiplatform/kit/ui';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCopy,
  type ModelConfigLocalSelectionProjection,
} from '@nimiplatform/kit/features/model-config';
import { useAppStore } from '../../app-shell/providers/app-store';
import {
  useDesktopRendererCommands,
  useDesktopRendererSdk,
} from '../../renderer/binding-context.js';
import {
  DESKTOP_NIMI_APP_ID,
  useDesktopNimiAppAIConfig,
  useDesktopNimiMachineLocalSelections,
  useOverwriteDesktopNimiAppAIConfig,
} from './chat-nimi-app-ai-config.js';
import { createDesktopCloudAIConfigModule } from './chat-cloud-ai-config-module.js';
import { toChatUserFacingRuntimeError } from './chat-runtime-error-message.js';

export type ChatSettingsPanelProps = {
  mode?: 'ai' | 'human';
  headerSlot?: ReactNode;
  diagnosticsContent?: ReactNode;
  presenceContent?: ReactNode;
  unavailableReason?: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  showPresenceContent?: boolean;
  showDiagnosticsFooter?: boolean;
};

export function DisabledSettingsNote(props: { label: string }) {
  return <InlineAlert tone="info">{props.label}</InlineAlert>;
}

function HumanModeSettings(props: {
  diagnosticsContent?: ReactNode;
  unavailableReason: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(true);
    return () => { props.onDiagnosticsVisibilityChange?.(false); };
  }, [props.onDiagnosticsVisibilityChange]);

  return (
    <Surface tone="card" className="space-y-3 p-4">
      <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
      </div>
      {props.diagnosticsContent || <DisabledSettingsNote label={props.unavailableReason} />}
    </Surface>
  );
}

function useNimiChatModelConfigCopy(): ModelConfigCopy {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t('Chat.settingsAIModelTitle', { defaultValue: 'AI Model' }),
    description: t('Chat.settingsAppAIConfigOwnerHint', {
      defaultValue: 'Nimi Desktop stores capability intent. Runtime validates the committed Local or Cloud choice when execution starts.',
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
      defaultValue: 'Use the model selected in Local AI Configurations.',
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
      defaultValue: 'Open Local AI Configurations',
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
    openCloudConnectorsLabel: t('Chat.settingsOpenCloudConnectors', { defaultValue: 'Configure Cloud Connectors' }),
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
    cloudAuthorizationLabel: t('Chat.settingsCloudAuthorization', { defaultValue: 'Account authorization' }),
    cloudAuthorizationNone: t('Chat.settingsCloudAuthorizationNone', { defaultValue: 'No authorization selected' }),
    cloudAuthorizationNeeded: t('Chat.settingsCloudGrantSelectionRequired', {
      defaultValue: 'Account authorization still needs to be selected.',
    }),
    cloudAuthorizationRevoked: t('Chat.settingsCloudGrantRevoked', {
      defaultValue: 'The selected account authorization is no longer active.',
    }),
    cloudConnectorLabel: t('Chat.settingsCloudConnector', { defaultValue: 'Connector for account authorization' }),
    cloudConnectorPlaceholder: t('Chat.settingsCloudConnectorPlaceholder', {
      defaultValue: 'Choose a connector for this provider',
    }),
    cloudCreateGrantLabel: t('Chat.settingsCloudCreateGrant', { defaultValue: 'Create authorization' }),
    cloudAuthorizationSeparation: t('Chat.settingsCloudAuthorizationSeparation', {
      defaultValue: 'Authorization identifies the account only. It does not choose or change the implementation or target.',
    }),
    cloudAccountLabel: (account: string) => t('Chat.settingsCloudAccount', {
      defaultValue: 'Account: {{account}}',
      account,
    }),
    cloudImpactAppLabel: (account: string) => t('Chat.settingsCloudAppImpactConfirmation', {
      defaultValue: 'I understand Nimi Chat requests may leave this machine, use account {{account}}, and incur provider cost.',
      account,
    }),
    cloudLoadFailed: t('Chat.settingsCloudChoicesLoadFailed', {
      defaultValue: 'Cloud implementation, target, or authorization choices could not be loaded.',
    }),
    retryLabel: t('Common.retry', { defaultValue: 'Retry' }),
    loadFailed: t('Chat.settingsAppAIConfigUnavailable', {
      defaultValue: 'Nimi Desktop AI intent could not be loaded from Runtime.',
    }),
    saveFailed: t('Chat.settingsAppAIConfigSaveFailed', {
      defaultValue: 'Runtime could not save the Nimi Desktop AI intent.',
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
    capabilityLabel: () => t('Chat.settingsTextCapability', { defaultValue: 'Text generation' }),
    capabilityDescription: () => t('Chat.settingsTextCapabilityDescription', {
      defaultValue: 'Controls how Nimi Chat resolves text generation.',
    }),
  }), [t]);
}

function AiModeSettings(props: {
  headerSlot?: ReactNode;
  presenceContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  unavailableReason: string;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  showPresenceContent?: boolean;
  showDiagnosticsFooter?: boolean;
}) {
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const sdk = useDesktopRendererSdk();
  const cloudAIConfig = useMemo(() => createDesktopCloudAIConfigModule(sdk), [sdk]);
  const { t } = useTranslation();
  const copy = useNimiChatModelConfigCopy();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const appAIConfig = useDesktopNimiAppAIConfig();
  const machineSelections = useDesktopNimiMachineLocalSelections();
  const overwriteAppAIConfig = useOverwriteDesktopNimiAppAIConfig();

  useEffect(() => {
    props.onDiagnosticsVisibilityChange?.(true);
    return () => { props.onDiagnosticsVisibilityChange?.(false); };
  }, [props.onDiagnosticsVisibilityChange]);

  const localSelections = useMemo<readonly ModelConfigLocalSelectionProjection[]>(() => (
    machineSelections.data ?? [{
      capabilityContract: 'text.generate',
      state: 'unavailable',
      configurationId: null,
      displayName: null,
      supportedFeatures: [],
      reasons: [],
    }]
  ), [machineSelections.data]);

  const openMachineConfiguration = useCallback(() => {
    setActiveTab('runtime');
    runtimeConfigNavigation.focusAction({
      page: 'localAiConfig',
      action: 'open-configurations',
      focus: 'runtime-config-action-focus.models-configurations',
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

  const footer = (
    <div className="space-y-2 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)] pt-3">
      {props.showDiagnosticsFooter !== false && props.diagnosticsContent ? (
        <div data-chat-settings-module="diagnostics" className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
            {t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}
          </div>
          {props.diagnosticsContent}
        </div>
      ) : props.showDiagnosticsFooter !== false ? (
        <DisabledSettingsNote label={props.unavailableReason} />
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      {props.headerSlot}
      {props.showPresenceContent !== false && props.presenceContent ? (
        <div data-chat-settings-module="avatar">{props.presenceContent}</div>
      ) : null}
      <div data-testid="nimi-app-ai-config">
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', consumer: 'nimi-first-party', appId: DESKTOP_NIMI_APP_ID }}
          capabilityContracts={['text.generate']}
          capabilities={appAIConfig.data?.capabilities ?? (appAIConfig.isPending ? undefined : null)}
          localSelections={localSelections}
          cloudAIConfig={cloudAIConfig}
          loading={appAIConfig.isPending}
          loadError={appAIConfig.isError ? copy.loadFailed : null}
          onRetry={() => { void appAIConfig.refetch(); }}
          onOverwrite={async (capabilities) => {
            await overwriteAppAIConfig.mutateAsync(capabilities);
          }}
          onOpenMachineConfiguration={openMachineConfiguration}
          onOpenCloudConnectorConfiguration={openCloudConnectorConfiguration}
          formatError={(error) => {
            const fallback = copy.saveFailed || 'Runtime could not save the Nimi Desktop AI intent.';
            const userFacing = toChatUserFacingRuntimeError(error, fallback, t);
            return {
              message: userFacing.message,
              technicalDetail: error instanceof Error ? error.message : String(error || ''),
            };
          }}
          copy={copy}
          footer={footer}
        />
      </div>
    </div>
  );
}

export function ChatSettingsPanel({
  mode = 'ai',
  headerSlot,
  diagnosticsContent,
  presenceContent,
  unavailableReason,
  onDiagnosticsVisibilityChange,
  showPresenceContent,
  showDiagnosticsFooter,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();
  const resolvedUnavailableReason = unavailableReason || t('Chat.settingsUnavailableReason', {
    defaultValue: 'This source does not expose runtime inspect yet.',
  });

  if (mode === 'ai') {
    return (
      <AiModeSettings
        headerSlot={headerSlot}
        presenceContent={presenceContent}
        diagnosticsContent={diagnosticsContent}
        unavailableReason={resolvedUnavailableReason}
        onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
        showPresenceContent={showPresenceContent}
        showDiagnosticsFooter={showDiagnosticsFooter}
      />
    );
  }

  return (
    <div className="space-y-5">
      {headerSlot}
      <HumanModeSettings
        diagnosticsContent={diagnosticsContent}
        unavailableReason={resolvedUnavailableReason}
        onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
      />
    </div>
  );
}
