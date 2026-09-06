import { useState } from 'react';
import { Button, InlineAlert, SearchField, StatusBadge } from '@nimiplatform/kit/ui';
import type { NimiRuntimeLocalVerifiedAssetDescriptor } from '@nimiplatform/sdk/runtime';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { formatBytes } from './runtime-config-model-center-utils';

export function filterVerifiedModelsForSearch(assets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[], query: string) {
  const terms = query.trim().toLowerCase().split(/[\s._-]+/u).filter(Boolean);
  return assets.filter((asset) => {
    const facts = [asset.assetId, asset.title, asset.description, asset.kind, asset.repo, asset.contentId, ...(asset.capabilities ?? []), ...asset.tags].join(' ').toLowerCase();
    return terms.every((term) => facts.includes(term));
  });
}

// @nimi-authority: rule.nimi.runtime.local-compute.r016
export function LocalModelCatalogSection(props: {
  readonly assets: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly loading: boolean;
  readonly error: string;
  readonly runtimeWritesDisabled: boolean;
  readonly onRefresh: () => void;
  readonly onInstall: (templateId: string) => Promise<void>;
}) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [installError, setInstallError] = useState('');
  const assets = filterVerifiedModelsForSearch(props.assets, query);
  const review = async (templateId: string) => {
    setBusy(templateId);
    setInstallError('');
    try {
      await props.onInstall(templateId);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section data-testid="runtime-builtin-catalog" className="space-y-3 rounded-2xl bg-[var(--nimi-surface-card)] p-5 ring-1 ring-[var(--nimi-border-subtle)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.localModelCenter.builtinCatalog')}</h3>
        <Button tone="ghost" size="sm" disabled={props.loading} onClick={props.onRefresh}>{t('runtimeConfig.localModelCenter.refresh')}</Button>
      </div>
      <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.builtinCatalogDescription')}</p>
      <SearchField value={query} onChange={(event) => setQuery(event.currentTarget.value)}
        aria-label={t('runtimeConfig.localModelCenter.searchBuiltinCatalog')} placeholder={t('runtimeConfig.localModelCenter.searchBuiltinCatalog')} />
      {props.error ? <InlineAlert tone="danger">{props.error}</InlineAlert> : null}
      {installError ? <InlineAlert tone="danger">{installError}</InlineAlert> : null}
      {props.loading ? <p role="status" className="text-sm text-[var(--nimi-text-muted)]">{t('Common.loading')}</p> : null}
      {!props.loading && !props.error && assets.length === 0 ? <p className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.localModelCenter.builtinCatalogEmpty')}</p> : null}
      <div className="max-h-96 divide-y divide-[var(--nimi-border-subtle)] overflow-y-auto">
        {assets.map((asset) => (
          <div key={asset.templateId} data-catalog-template={asset.templateId} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{asset.title}</span>
                <StatusBadge tone="neutral" shape="soft">{asset.kind}</StatusBadge>
              </div>
              <p className="mt-1 break-words text-xs text-[var(--nimi-text-muted)]">{[asset.repo, asset.license, asset.totalSizeBytes ? formatBytes(asset.totalSizeBytes) : ''].filter(Boolean).join(' · ')}</p>
            </div>
            <Button tone="secondary" size="sm" loading={busy === asset.templateId}
              disabled={busy !== null || props.runtimeWritesDisabled} onClick={() => { void review(asset.templateId); }}>
              {t('runtimeConfig.recommend.reviewInstallPlan')}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
