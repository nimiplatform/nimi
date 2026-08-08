import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCopy,
  type ModelConfigLocalSelectionProjection,
} from '@nimiplatform/kit/features/model-config';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { StatusBadge } from '@nimiplatform/kit/ui';

import { useTranslation } from '../../shell/i18n/index.js';
import { useTesterRendererHost } from '../../renderer/context.js';
import { appId } from '../../shell/auth/app-identity.js';
import {
  testerCapabilities,
  testerModelConfigCapabilityContracts,
} from '../tester-capabilities.js';
import type { TesterRuntimeInspection } from '../tester-runtime.js';
import {
  loadTesterAIConfig,
  overwriteTesterAIConfig,
  toTesterModelConfigCapabilities,
  toTesterPortableAIConfigCapabilities,
} from '../tester-ai-config-store.js';

type TesterAiConfigSettingsPanelProps = {
  runtime: TesterRuntimeInspection | null;
  capabilityId: string;
  onConfigChanged: () => void;
  onClose?: () => void;
};

// Full ModelConfigCopy override so the shared Kit surface never falls back to
// its built-in English defaults. Values come from the tester i18n bundle; zh
// wording mirrors Nimi Desktop's Chat settings copy.
function useTesterModelConfigCopy(): ModelConfigCopy {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t('ModelConfig.title'),
    description: t('ModelConfig.description'),
    backLabel: t('ModelConfig.backLabel'),
    detailTitle: (capabilityLabel: string) => t('ModelConfig.detailTitle', { capability: capabilityLabel }),
    activeModelLabel: t('ModelConfig.activeModelLabel'),
    activeModelHint: t('ModelConfig.activeModelHint'),
    activeModelConfiguredLabel: t('ModelConfig.activeModelConfiguredLabel'),
    activeModelSetupPendingLabel: t('ModelConfig.activeModelSetupPendingLabel'),
    modelPickerTitle: t('ModelConfig.modelPickerTitle'),
    modelPickerSearchPlaceholder: t('ModelConfig.modelPickerSearchPlaceholder'),
    modelPickerLoadingLabel: t('ModelConfig.modelPickerLoadingLabel'),
    modelPickerEmptyLabel: t('ModelConfig.modelPickerEmptyLabel'),
    configuredSummary: t('ModelConfig.configuredSummary'),
    emptySummary: t('ModelConfig.emptySummary'),
    routeLabel: t('ModelConfig.routeLabel'),
    localLabel: t('ModelConfig.localLabel'),
    cloudLabel: t('ModelConfig.cloudLabel'),
    saveLocalLabel: t('ModelConfig.saveLocalLabel'),
    saveCloudLabel: t('ModelConfig.saveCloudLabel'),
    savingLabel: t('ModelConfig.savingLabel'),
    advancedLabel: t('ModelConfig.advancedLabel'),
    advancedHint: t('ModelConfig.advancedHint'),
    requiredFeaturesLabel: t('ModelConfig.requiredFeaturesLabel'),
    requiredFeaturesPlaceholder: t('ModelConfig.requiredFeaturesPlaceholder'),
    defaultsLabel: t('ModelConfig.defaultsLabel'),
    defaultsPlaceholder: t('ModelConfig.defaultsPlaceholder'),
    defaultsUnsetLabel: t('ModelConfig.defaultsUnsetLabel'),
    defaultsTrueLabel: t('ModelConfig.defaultsTrueLabel'),
    defaultsFalseLabel: t('ModelConfig.defaultsFalseLabel'),
    defaultsListPlaceholder: t('ModelConfig.defaultsListPlaceholder'),
    defaultsLocalEffectivePlaceholder: (value: string) => t('ModelConfig.defaultsLocalEffectivePlaceholder', { value }),
    defaultsCloudEffectivePlaceholder: t('ModelConfig.defaultsCloudEffectivePlaceholder'),
    defaultsRandomValue: t('ModelConfig.defaultsRandomValue'),
    localChoiceDescription: t('ModelConfig.localChoiceDescription'),
    localSelectedLabel: t('ModelConfig.localSelectedLabel'),
    localMissingLabel: t('ModelConfig.localMissingLabel'),
    localBrokenLabel: t('ModelConfig.localBrokenLabel'),
    localUnavailableLabel: t('ModelConfig.localUnavailableLabel'),
    localMismatchLabel: (features: string) => t('ModelConfig.localMismatchLabel', { features }),
    openMachineLabel: t('ModelConfig.openMachineLabel'),
    cloudConnectorPickerLabel: t('ModelConfig.cloudConnectorPickerLabel'),
    cloudConnectorPickerPlaceholder: t('ModelConfig.cloudConnectorPickerPlaceholder'),
    cloudConnectorSelectionRequired: t('ModelConfig.cloudConnectorSelectionRequired'),
    cloudNoConnectorsLabel: t('ModelConfig.cloudNoConnectorsLabel'),
    openCloudConnectorsLabel: t('ModelConfig.openCloudConnectorsLabel'),
    cloudImplementationLabel: t('ModelConfig.cloudImplementationLabel'),
    cloudImplementationPlaceholder: t('ModelConfig.cloudImplementationPlaceholder'),
    cloudTargetLabel: t('ModelConfig.cloudTargetLabel'),
    cloudTargetPlaceholder: t('ModelConfig.cloudTargetPlaceholder'),
    cloudTargetDialogTitle: t('ModelConfig.cloudTargetDialogTitle'),
    cloudTargetDialogDescription: t('ModelConfig.cloudTargetDialogDescription'),
    cloudTargetConfirmation: t('ModelConfig.cloudTargetConfirmation'),
    cloudAuthorizationLabel: t('ModelConfig.cloudAuthorizationLabel'),
    cloudAuthorizationNone: t('ModelConfig.cloudAuthorizationNone'),
    cloudAuthorizationNeeded: t('ModelConfig.cloudAuthorizationNeeded'),
    cloudAuthorizationRevoked: t('ModelConfig.cloudAuthorizationRevoked'),
    cloudConnectorLabel: t('ModelConfig.cloudConnectorLabel'),
    cloudConnectorPlaceholder: t('ModelConfig.cloudConnectorPlaceholder'),
    cloudCreateGrantLabel: t('ModelConfig.cloudCreateGrantLabel'),
    cloudAuthorizationSeparation: t('ModelConfig.cloudAuthorizationSeparation'),
    cloudAccountLabel: (account: string) => t('ModelConfig.cloudAccountLabel', { account }),
    cloudImpactAppLabel: (account: string) => t('ModelConfig.cloudImpactAppLabel', { account }),
    cloudImpactSharedLabel: (account: string) => t('ModelConfig.cloudImpactSharedLabel', { account }),
    cloudLoadFailed: t('ModelConfig.cloudLoadFailed'),
    retryLabel: t('Common.retry'),
    loadFailed: t('ModelConfig.loadFailed'),
    saveFailed: t('ModelConfig.saveFailed'),
    technicalDetailsLabel: t('ModelConfig.technicalDetailsLabel'),
    unsupportedCapabilityLabel: t('ModelConfig.unsupportedCapabilityLabel'),
    notConfiguredLabel: t('ModelConfig.notConfiguredLabel'),
    configuredLabel: t('ModelConfig.configuredLabel'),
    selectionRequiredLabel: t('ModelConfig.selectionRequiredLabel'),
    blockedLabel: t('ModelConfig.blockedLabel'),
    mismatchLabel: t('ModelConfig.mismatchLabel'),
    cancelLabel: t('Common.cancel'),
    confirmSelectionLabel: t('ModelConfig.confirmSelectionLabel'),
    capabilityLabel: (capabilityContract, fallback) => {
      const entry = testerCapabilities.find((item) => item.capabilityContract === capabilityContract);
      return entry ? t(entry.labelKey) : fallback;
    },
    capabilityDescription: (capabilityContract, fallback) => {
      const entry = testerCapabilities.find((item) => item.capabilityContract === capabilityContract);
      return entry ? t(entry.summaryKey) : fallback;
    },
  }), [t]);
}

export function TesterAiConfigSettingsPanel({
  runtime,
  capabilityId,
  onConfigChanged,
}: TesterAiConfigSettingsPanelProps) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const copy = useTesterModelConfigCopy();
  const [config, setConfig] = useState<NimiPortableAppAIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localSelections, setLocalSelections] = useState<readonly ModelConfigLocalSelectionProjection[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setConfig(await loadTesterAIConfig(rendererHost.sdk.aiConfig));
      try {
        setLocalSelections(await rendererHost.sdk.modelConfig.localSelections());
      } catch {
        setLocalSelections(testerModelConfigCapabilityContracts.map((capabilityContract) => ({
          capabilityContract,
          state: 'unavailable',
          configurationId: null,
          displayName: null,
          supportedFeatures: [],
          reasons: ['machine-local-ai-configuration-unavailable'],
          effectiveDefaults: null,
        })));
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause || t('ModelConfig.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [rendererHost, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runtimeLabel = runtime?.status === 'connected'
    ? t('ModelConfig.runtimeConnected')
    : runtime?.status === 'simulated'
      ? t('ModelConfig.runtimeSimulated')
      : t('ModelConfig.runtimeUnavailable');

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t('ModelConfig.drawerDescription')}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', consumer: 'third-party-app', appId }}
          capabilityContracts={testerModelConfigCapabilityContracts}
          initialCapabilityContract={capabilityId}
          capabilities={loading || loadError
            ? undefined
            : config ? toTesterModelConfigCapabilities(config.capabilities) : null}
          localSelections={localSelections}
          loading={loading}
          loadError={loadError}
          onRetry={() => { void refresh(); }}
          onOpenCloudConnectorConfiguration={() => {
            void openDesktopIntent({
              intent: {
                kind: 'open-runtime-config',
                page: 'cloud',
                action: 'add-connector',
              },
            });
          }}
          onOverwrite={async (capabilities) => {
            const next = await overwriteTesterAIConfig(
              rendererHost.sdk.aiConfig,
              toTesterPortableAIConfigCapabilities(capabilities),
            );
            setConfig(next);
            onConfigChanged();
          }}
          formatError={(error) => ({
            message: t('ModelConfig.saveFailed'),
            technicalDetail: error instanceof Error ? error.message : String(error || ''),
          })}
          copy={copy}
          headerSlot={(
            <div className="space-y-3">
              <StatusBadge tone={runtime?.status === 'connected' ? 'neutral' : 'warning'} shape="dot">
                {runtimeLabel}
              </StatusBadge>
              <p className="m-0 text-sm leading-5 text-[var(--nimi-text-muted)]">
                {t('ModelConfig.headerDescription')}
              </p>
            </div>
          )}
          footer={(
            <p className="m-0 border-t border-[var(--nimi-border-subtle)] pt-4 text-xs leading-5 text-[var(--nimi-text-muted)]">
              {t('ModelConfig.footerNote')}
            </p>
          )}
        />
      </div>
    </section>
  );
}
