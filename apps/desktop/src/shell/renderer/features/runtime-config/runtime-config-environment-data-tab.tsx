import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NimiText, Surface } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useAppStore } from '../../app-shell/providers/app-store';

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
 * root only. Account-level actions (cache clearing, account deletion, logout)
 * live exclusively in Settings > Data Management; this tab deep-links there
 * instead of duplicating them.
 */
export function EnvironmentDataTab() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [dataRoot, setDataRoot] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
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
    }
  }, [bindings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSettingsDataManagement = () => {
    bindings.app.commands.settings.openSection('data');
    setActiveTab('settings');
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {loadFailed ? (
        <NimiText role="helper">{t('runtimeConfig.environment.dataLoadFailed', { defaultValue: 'Storage information is unavailable.' })}</NimiText>
      ) : null}
      <Surface tone="card" padding="none" className="p-4">
        <div className="flex items-start justify-between gap-3">
          <NimiText as="h3" role="card-title">
            {t('runtimeConfig.environment.dataStorageTitle', { defaultValue: 'Storage Usage' })}
          </NimiText>
          <button
            type="button"
            onClick={() => { void refresh(); }}
            className="text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-bg)] hover:underline"
          >
            {t('runtimeConfig.environment.dataRefresh', { defaultValue: 'Refresh' })}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <NimiText as="span" role="body">
              {t('runtimeConfig.environment.dataStorageUsed', { defaultValue: 'Estimated used' })}
            </NimiText>
            <NimiText as="span" role="label" className="text-[var(--nimi-text-primary)]">
              {usage ? formatBytes(usage.estimatedUsageBytes) : '-'}
            </NimiText>
          </div>
          <div className="flex items-center justify-between">
            <NimiText as="span" role="body">
              {t('runtimeConfig.environment.dataStorageQuota', { defaultValue: 'Quota' })}
            </NimiText>
            <NimiText as="span" role="label" className="text-[var(--nimi-text-primary)]">
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
        className="self-start text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-bg)] hover:underline"
      >
        {t('runtimeConfig.environment.dataManageInSettings', { defaultValue: 'Manage cache and account data in Settings' })}
      </button>
    </div>
  );
}
