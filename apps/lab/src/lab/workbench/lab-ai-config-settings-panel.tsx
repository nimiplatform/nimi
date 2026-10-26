import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import type { StudioRuntimeInspection } from '../../ai-studio-core/index.js';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCopy,
} from '@nimiplatform/kit/features/model-config';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { Button, StatusBadge } from '@nimiplatform/kit/ui';

import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { appId } from '../../shell/auth/app-identity.js';
import {
  labCapabilities,
  labModelConfigCapabilityContracts,
} from '../lab-capabilities.js';
import {
  loadLabAIConfig,
  projectLabAIConfigCapabilities,
  subscribeLabAIConfigOwnerRefresh,
} from '../lab-ai-config-store.js';

type LabAiConfigSettingsPanelProps = {
  runtime: StudioRuntimeInspection | null;
  capabilityId: string;
  onCommitted: () => void;
};

// The protected Lab mount uses the same canonical manager contract as Desktop;
// the Desktop handoff remains an optional centralized-management convenience.
function useLabModelConfigCopy(): ModelConfigCopy {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t('ModelConfig.title'),
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
    cloudLabel: t('ModelConfig.cloudLabel'),
    saveLocalLabel: t('ModelConfig.saveLabel'),
    saveCloudLabel: t('ModelConfig.saveLabel'),
    savingLabel: t('ModelConfig.savingLabel'),
    savedLabel: t('ModelConfig.savedLabel'),
    saveFailed: t('ModelConfig.saveFailed'),
    technicalDetailsLabel: t('ModelConfig.technicalDetailsLabel'),
    cancelLabel: t('Common.cancel'),
    confirmSelectionLabel: t('ModelConfig.confirmSelectionLabel'),
    clearLabel: t('ModelConfig.clearLabel'),
    clearingLabel: t('ModelConfig.clearingLabel'),
    conflictLabel: t('ModelConfig.conflictLabel'),
    conflictDescription: t('ModelConfig.conflictDescription'),
    conflictCurrentLabel: (revision: string, summary: string) => t('ModelConfig.conflictCurrentLabel', { revision, summary }),
    localLabel: t('ModelConfig.localLabel'),
    localChoiceDescription: t('ModelConfig.localChoiceDescription'),
    localMissingLabel: t('ModelConfig.localMissingLabel'),
    localSelectedLabel: t('ModelConfig.localSelectedLabel'),
    localBrokenLabel: t('ModelConfig.localBrokenLabel'),
    localUnavailableLabel: t('ModelConfig.localUnavailableLabel'),
    localMismatchLabel: (features: string) => t('ModelConfig.localMismatchLabel', { features }),
    openCloudConnectorsLabel: t('ModelConfig.openOwnerConfigurationLabel'),
    cloudBlockedLabel: t('ModelConfig.cloudBlockedLabel'),
    cloudCatalogStaleLabel: t('ModelConfig.cloudCatalogStaleLabel'),
    cloudChatGPTPlanLabel: t('ModelConfig.cloudChatGPTPlanLabel'),
    cloudChatGPTPlanDescription: t('ModelConfig.cloudChatGPTPlanDescription'),
    retryLabel: t('Common.retry'),
    loadFailed: t('ModelConfig.loadFailed'),
    unsupportedCapabilityLabel: t('ModelConfig.unsupportedCapabilityLabel'),
    notConfiguredLabel: t('ModelConfig.notConfiguredLabel'),
    configuredLabel: t('ModelConfig.configuredLabel'),
    selectionRequiredLabel: t('ModelConfig.selectionRequiredLabel'),
    blockedLabel: t('ModelConfig.blockedLabel'),
    unavailableLabel: t('ModelConfig.unavailableLabel'),
    mismatchLabel: t('ModelConfig.mismatchLabel'),
    capabilityLabel: (capabilityContract, fallback) => {
      const entry = labCapabilities.find((item) => item.capabilityContract === capabilityContract);
      return entry ? t(entry.labelKey) : fallback;
    },
    capabilityDescription: (capabilityContract, fallback) => {
      const entry = labCapabilities.find((item) => item.capabilityContract === capabilityContract);
      return entry ? t(entry.summaryKey) : fallback;
    },
  }), [t]);
}

export function LabAiConfigSettingsPanel({
  runtime,
  capabilityId,
  onCommitted,
}: LabAiConfigSettingsPanelProps) {
  const rendererHost = useLabRendererHost();
  const { t, i18n } = useTranslation();
  const copy = useLabModelConfigCopy();
  const scope = useMemo(() => ({ active: false, readSequence: 0 }), [rendererHost]);
  const [observation, setObservation] = useState(() => ({
    scope,
    snapshot: null as NimiAIConfigSnapshot | null,
    loading: true,
    loadError: null as string | null,
  }));
  // A replaced protected renderer scope must not display the prior owner's
  // snapshot while its first read is still pending.
  const { snapshot, loading, loadError } = observation.scope === scope
    ? observation
    : { snapshot: null, loading: true, loadError: null };

  const refresh = useCallback(async () => {
    if (!scope.active) return;
    const sequence = ++scope.readSequence;
    const isCurrent = () => scope.active && scope.readSequence === sequence;
    setObservation((current) => ({ scope,
      snapshot: current.scope === scope ? current.snapshot : null,
      loading: true, loadError: null,
    }));
    try {
      const next = await loadLabAIConfig(rendererHost.sdk.aiConfig);
      if (isCurrent()) setObservation({ scope, snapshot: next, loading: false, loadError: null });
    } catch (cause) {
      if (isCurrent()) setObservation((current) => ({ ...current,
        loading: false,
        loadError: cause instanceof Error ? cause.message : String(cause || t('ModelConfig.loadFailed')),
      }));
    }
  }, [rendererHost, scope, t]);

  useEffect(() => {
    scope.active = true;
    void refresh();
    const unsubscribe = subscribeLabAIConfigOwnerRefresh(
      () => { void refresh(); },
      window,
      document,
    );
    return () => {
      scope.active = false;
      scope.readSequence += 1;
      unsubscribe();
    };
  }, [refresh, scope]);

  const runtimeLabel = runtime?.status === 'connected'
    ? t('ModelConfig.runtimeConnected')
    : t('ModelConfig.runtimeUnavailable');

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t('ModelConfig.drawerDescription')}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', appId }}
          capabilityContracts={labModelConfigCapabilityContracts}
          initialCapabilityContract={capabilityId}
          capabilities={snapshot?.config
            ? projectLabAIConfigCapabilities(snapshot.config.capabilities)
            : snapshot ? null : undefined}
          revision={snapshot?.revision}
          effectiveSelections={snapshot?.effectiveSelections}
          listOptions={(query) => rendererHost.sdk.aiConfig.listOptions(query)}
          loading={loading && !snapshot}
          loadError={loadError}
          onRetry={() => { void refresh(); }}
          onOverwrite={async (input) => {
            const result = await rendererHost.sdk.aiConfig.overwrite(input);
            if (scope.active) {
              // The acknowledgement supersedes every read started before it.
              scope.readSequence += 1;
              setObservation({ scope,
                snapshot: { config: result.config, revision: result.revision, effectiveSelections: [] },
                loading: false, loadError: null,
              });
            }
            // A commit re-reads every mounted consumer, this panel included,
            // even when the drawer closed before the write finished.
            if (result.outcome === 'committed') onCommitted();
            else void refresh();
            return result;
          }}
          onOpenOwnerConfiguration={() => {
            void openDesktopIntent({
              intent: {
                kind: 'open-apps',
                appId,
                section: 'ai-models',
              },
            });
          }}
          copy={copy}
          language={i18n.language}
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
              <Button onClick={() => { void openDesktopIntent({ intent: { kind: 'open-apps', appId, section: 'ai-models' } }); }}>
                {t('ModelConfig.openOwnerConfigurationLabel')}
              </Button>
            </p>
          )}
        />
      </div>
    </section>
  );
}
