import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, Surface } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type StorageUsage = {
  localStorageBytes: number;
  estimatedUsageBytes: number;
  estimatedQuotaBytes: number;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Runtime-scoped data & storage view: operational storage estimate and data
 * root only. Account-level actions (cache clearing, Web account-management handoff, logout)
 * live exclusively in Settings > Data Management; this tab deep-links there
 * instead of duplicating them.
 */
export function EnvironmentDataTab() {
  const navigation = useHomeNavigation();
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();

  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [dataRoot, setDataRoot] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [estimate, dirs] = await Promise.all([
        bindings.app.commands.settings.estimateStorageUsage(),
        bindings.app.commands.settings.loadStorageDirs(),
      ]);
      setUsage(estimate);
      setDataRoot(dirs.dataRoot);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [bindings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSettingsDataManagement = () => {
    void navigation.push({ id: 'settings', settingsSection: 'data' });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {loadFailed ? (
        <InlineAlert tone="warning" role="alert">
          {t('runtimeConfig.environment.dataLoadFailed', { defaultValue: 'Storage information is unavailable.' })}
        </InlineAlert>
      ) : null}
      <Surface tone="card" padding="none" className="p-4">
        <div className="flex items-start justify-between gap-3">
          <NimiText as="h3" role="card-title">
            {t('runtimeConfig.environment.dataStorageTitle', { defaultValue: 'App data storage (this shell)' })}
          </NimiText>
          <Button
            type="button"
            tone="ghost"
            size="sm"
            loading={refreshing}
            onClick={() => { void refresh(); }}
          >
            {t('runtimeConfig.environment.dataRefresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <NimiText as="span" role="body">
              {t('runtimeConfig.environment.dataStorageUsed', { defaultValue: 'Estimated used by this app' })}
            </NimiText>
            <NimiText as="span" role="label" className="tabular-nums text-[var(--nimi-text-primary)]">
              {usage ? formatBytes(usage.estimatedUsageBytes) : '-'}
            </NimiText>
          </div>
          <div className="flex items-center justify-between">
            <NimiText as="span" role="body">
              {t('runtimeConfig.environment.dataStorageQuota', { defaultValue: 'Quota' })}
            </NimiText>
            <NimiText as="span" role="label" className="tabular-nums text-[var(--nimi-text-primary)]">
              {usage && usage.estimatedQuotaBytes > 0 ? formatBytes(usage.estimatedQuotaBytes) : '-'}
            </NimiText>
          </div>
        </div>
      </Surface>

      <Surface tone="card" padding="none" className="p-4">
        <NimiText as="h3" role="card-title">
          {t('runtimeConfig.environment.dataRootTitle', { defaultValue: 'Data Root' })}
        </NimiText>
        <NimiText role="caption" className="mt-2 block break-all">
          {dataRoot || '-'}
        </NimiText>
      </Surface>

      <button
        type="button"
        onClick={openSettingsDataManagement}
        data-testid="runtime-environment-data-open-settings"
        className="self-start rounded px-1 py-0.5 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-bg)] transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] active:scale-[var(--nimi-motion-pressed-scale)]"
      >
        {t('runtimeConfig.environment.dataManageInSettings', { defaultValue: 'Manage cache and account data in Settings' })}
      </button>
    </div>
  );
}
