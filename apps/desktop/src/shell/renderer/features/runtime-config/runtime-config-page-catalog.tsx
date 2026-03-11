import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { Button, Card } from './runtime-config-primitives';
import {
  sdkDeleteModelCatalogProvider,
  sdkListModelCatalogProviders,
  sdkUpsertModelCatalogProvider,
  type RuntimeModelCatalogProvider,
} from './runtime-config-catalog-sdk-service';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

type CatalogPageProps = {
  state: RuntimeConfigStateV11;
};

const MODEL_CATALOG_UPDATED_EVENT = 'nimi:runtime:model-catalog-updated';

function emitModelCatalogUpdated(provider: string) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  if (typeof CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(MODEL_CATALOG_UPDATED_EVENT, {
    detail: {
      provider,
      updatedAt: new Date().toISOString(),
    },
  }));
}

export function CatalogPage({ state: _state }: CatalogPageProps) {
  const { t } = useTranslation();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [providers, setProviders] = useState<RuntimeModelCatalogProvider[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingProvider, setSavingProvider] = useState('');
  const [deletingProvider, setDeletingProvider] = useState('');

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await sdkListModelCatalogProviders();
      setProviders(rows);
      setDrafts((previous) => {
        const next = { ...previous };
        for (const row of rows) {
          if (!next[row.provider]) {
            next[row.provider] = row.yaml;
          }
        }
        for (const provider of Object.keys(next)) {
          if (!rows.some((row) => row.provider === provider)) {
            delete next[provider];
          }
        }
        return next;
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Catalog load failed: ${error instanceof Error ? error.message : String(error || '')}`,
      });
    } finally {
      setLoading(false);
    }
  }, [setStatusBanner]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const providerRows = useMemo(
    () => providers.slice().sort((a, b) => a.provider.localeCompare(b.provider)),
    [providers],
  );

  const onDraftChange = useCallback((provider: string, value: string) => {
    setDrafts((previous) => ({
      ...previous,
      [provider]: value,
    }));
  }, []);

  const onSaveProvider = useCallback(async (provider: string) => {
    const yaml = String(drafts[provider] || '').trim();
    if (!yaml) {
      setStatusBanner({
        kind: 'error',
        message: `Save failed: ${provider} yaml is empty.`,
      });
      return;
    }
    setSavingProvider(provider);
    try {
      await sdkUpsertModelCatalogProvider(provider, yaml);
      await loadProviders();
      emitModelCatalogUpdated(provider);
      setStatusBanner({
        kind: 'success',
        message: `Catalog saved for ${provider}.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Save failed for ${provider}: ${error instanceof Error ? error.message : String(error || '')}`,
      });
    } finally {
      setSavingProvider('');
    }
  }, [drafts, loadProviders, setStatusBanner]);

  const onRestoreDefault = useCallback(async (provider: string) => {
    setDeletingProvider(provider);
    try {
      await sdkDeleteModelCatalogProvider(provider);
      await loadProviders();
      emitModelCatalogUpdated(provider);
      setStatusBanner({
        kind: 'success',
        message: `Custom catalog removed for ${provider}; runtime now uses default snapshot.`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: `Restore default failed for ${provider}: ${error instanceof Error ? error.message : String(error || '')}`,
      });
    } finally {
      setDeletingProvider('');
    }
  }, [loadProviders, setStatusBanner]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {t('runtimeConfig.catalog.providerCatalog', { defaultValue: 'Provider Catalog' })}
            </p>
            <p className="text-xs text-gray-500">
              {t('runtimeConfig.catalog.providerCatalogDesc', {
                defaultValue: 'Runtime effective catalog = built-in default + custom provider yaml. Save writes custom yaml into runtime custom dir.',
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void loadProviders()} disabled={loading}>
              {loading
                ? t('runtimeConfig.catalog.refreshing', { defaultValue: 'Refreshing...' })
                : t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </div>
      </Card>

      {providerRows.map((row) => {
        const draft = String(drafts[row.provider] || row.yaml || '');
        const saving = savingProvider === row.provider;
        const deleting = deletingProvider === row.provider;
        return (
          <Card key={`catalog-provider-${row.provider}`} className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">{row.provider}</p>
                <p className="text-xs text-gray-500">
                  source={row.source} · version={row.version} · catalog={row.catalogVersion || 'unknown'} · models={row.modelCount} · voices={row.voiceCount}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void onRestoreDefault(row.provider)}
                  disabled={saving || deleting || row.source === 'builtin'}
                >
                  {deleting
                    ? t('runtimeConfig.catalog.restoring', { defaultValue: 'Restoring...' })
                    : t('runtimeConfig.catalog.restoreDefault', { defaultValue: 'Restore Default' })}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void onSaveProvider(row.provider)}
                  disabled={saving || deleting || draft.trim().length === 0}
                >
                  {saving
                    ? t('runtimeConfig.catalog.saving', { defaultValue: 'Saving...' })
                    : t('runtimeConfig.catalog.saveYaml', { defaultValue: 'Save YAML' })}
                </Button>
              </div>
            </div>
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(row.provider, event.target.value)}
              spellCheck={false}
              className="min-h-[260px] w-full rounded-[10px] border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </Card>
        );
      })}
    </div>
  );
}
