import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import type { StudioRuntimeInspection } from '../../ai-studio-core/index.js';
import {
  ModelConfigAIConfigSurface,
  type ModelConfigCopy,
} from '@nimiplatform/kit/features/model-config';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { StatusBadge } from '@nimiplatform/kit/ui';

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
    clearLabel: t('ModelConfig.clearLabel'),
    clearingLabel: t('ModelConfig.clearingLabel'),
    conflictLabel: t('ModelConfig.conflictLabel'),
    conflictDescription: t('ModelConfig.conflictDescription'),
    conflictCurrentLabel: (revision: string, summary: string) => t('ModelConfig.conflictCurrentLabel', { revision, summary }),
    localLabel: t('ModelConfig.localLabel'),
    localSelectedLabel: t('ModelConfig.localSelectedLabel'),
    localBrokenLabel: t('ModelConfig.localBrokenLabel'),
    localUnavailableLabel: t('ModelConfig.localUnavailableLabel'),
    localMismatchLabel: (features: string) => t('ModelConfig.localMismatchLabel', { features }),
    openCloudConnectorsLabel: t('ModelConfig.openOwnerConfigurationLabel'),
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
}: LabAiConfigSettingsPanelProps) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const copy = useLabModelConfigCopy();
  const [snapshot, setSnapshot] = useState<NimiAIConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSnapshot(await loadLabAIConfig(rendererHost.sdk.aiConfig));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause || t('ModelConfig.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [rendererHost, t]);

  useEffect(() => {
    void refresh();
    return subscribeLabAIConfigOwnerRefresh(
      () => { void refresh(); },
      window,
      document,
    );
  }, [refresh]);

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
            setSnapshot({ config: result.config, revision: result.revision, effectiveSelections: [] });
            void refresh();
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
