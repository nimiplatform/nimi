import { useDesktopI18nResource } from '../../i18n/i18n-context';

import { Surface } from '@nimiplatform/kit/ui';
import type { NimiRuntimeLocalVerifiedAssetDescriptor } from '@nimiplatform/sdk/runtime';
import {
  DownloadIcon,
  FolderOpenIcon,
  formatAssetKindLabel,
  isRecommendedDescriptor,
  RefreshIcon,
  StarIcon,
} from './runtime-config-local-model-center-helpers';
import {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterAssetTasksSection,
} from './runtime-config-local-model-center-progress-sections';
import { Button } from './runtime-config-primitives';

type VerifiedAssetsSectionProps = {
  hasSearchQuery: boolean;
  loadingVerifiedAssets: boolean;
  assetBusy: boolean;
  visibleVerifiedAssets: NimiRuntimeLocalVerifiedAssetDescriptor[];
  isAssetPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallAsset: (templateId: string) => void;
};

function LocalModelCenterVerifiedAssetsSection(props: VerifiedAssetsSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  return (
    <Surface tone="card" elevation="base" padding="none" className="rounded-xl p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="h-4 w-4 text-[var(--nimi-text-muted)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.verifiedAssetOffers', { defaultValue: 'Catalog ModelAsset Offers' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedAssets || props.assetBusy}
          className="flex items-center gap-1.5 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      {props.loadingVerifiedAssets ? (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.loadingVerifiedAssets', { defaultValue: 'Loading verified assets...' })}
          </p>
        </div>
      ) : props.visibleVerifiedAssets.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.visibleVerifiedAssets.slice(0, props.hasSearchQuery ? 12 : 6).map((asset) => {
            const pending = props.isAssetPending(asset.templateId);
            return (
              <div key={asset.templateId} className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] p-3 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--nimi-text-muted)] to-[var(--nimi-text-secondary)] text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-action-primary-text)]">
                  {formatAssetKindLabel(asset.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{asset.title}</p>
                    {isRecommendedDescriptor(asset.tags) ? (
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]">
                        {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                      </span>
                    ) : null}
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                      {formatAssetKindLabel(asset.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{asset.assetId}</p>
                  {asset.description ? <p className="mt-0.5 truncate text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{asset.description}</p> : null}
                </div>
                <Button
                  size="sm"
                  onClick={() => props.onInstallAsset(asset.templateId)}
                  disabled={props.assetBusy || pending}
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {pending
                    ? i18n.t('runtimeConfig.localModelCenter.installing', { defaultValue: 'Installing...' })
                    : i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {props.hasSearchQuery
              ? i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsMatchSearch', { defaultValue: 'No catalog ModelAsset offers matched your search.' })
              : i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsForFilter', { defaultValue: 'No catalog ModelAsset offers are available for the current filter.' })}
          </p>
        </div>
      )}
    </Surface>
  );
}

type QuickPicksSectionProps = {
  loadingVerifiedModels: boolean;
  installing: boolean;
  verifiedModels: NimiRuntimeLocalVerifiedAssetDescriptor[];
  onRefresh: () => void;
  onInstallCatalogQuickPick: (templateId: string) => void;
};

function LocalModelCenterQuickPicksSection(props: QuickPicksSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  if (props.verifiedModels.length === 0) {
    return null;
  }

  return (
    <Surface tone="card" elevation="base" padding="none" className="rounded-xl p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StarIcon className="h-4 w-4 text-[var(--nimi-status-warning)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.quickPicks', { defaultValue: 'Quick Picks' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedModels}
          className="flex items-center gap-1.5 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {props.verifiedModels.map((item) => {
          return (
            <div key={item.templateId} className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] p-3 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--nimi-status-warning)] to-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
                <StarIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{item.title}</p>
                  {isRecommendedDescriptor(item.tags) ? (
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]">
                      {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-[var(--nimi-text-muted)]">{item.assetId}</p>
              </div>
              <Button
                size="sm"
                onClick={() => props.onInstallCatalogQuickPick(item.templateId)}
                disabled={props.installing}
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
              </Button>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

export {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterAssetTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedAssetsSection,
};
