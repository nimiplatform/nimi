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
  projectTesterAIConfigCapabilities,
  subscribeTesterAIConfigOwnerRefresh,
} from '../tester-ai-config-store.js';

type TesterAiConfigSettingsPanelProps = {
  runtime: TesterRuntimeInspection | null;
  capabilityId: string;
};

// The protected Tester mount is projection-only. It supplies only copy used by
// Kit's third-party read surface and one exact Desktop owner handoff.
function useTesterModelConfigCopy(): ModelConfigCopy {
  const { t } = useTranslation();
  return useMemo(() => ({
    title: t('ModelConfig.title'),
    backLabel: t('ModelConfig.backLabel'),
    detailTitle: (capabilityLabel: string) => t('ModelConfig.detailTitle', { capability: capabilityLabel }),
    activeModelLabel: t('ModelConfig.activeModelLabel'),
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
    mismatchLabel: t('ModelConfig.mismatchLabel'),
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
          loadoutId: null,
          displayName: null,
          supportedFeatures: [],
          reasons: ['machine-loadout-unavailable'],
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
    return subscribeTesterAIConfigOwnerRefresh(
      () => { void refresh(); },
      window,
      document,
    );
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
            : config ? projectTesterAIConfigCapabilities(config.capabilities) : null}
          localSelections={localSelections}
          loading={loading}
          loadError={loadError}
          onRetry={() => { void refresh(); }}
          onOpenOwnerConfiguration={() => {
            void openDesktopIntent({
              intent: {
                kind: 'open-apps',
                appId,
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
