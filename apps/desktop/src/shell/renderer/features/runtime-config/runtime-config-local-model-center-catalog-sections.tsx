import { useDesktopI18nResource } from '../../i18n/i18n-context';

import { Surface } from '@nimiplatform/kit/ui';
import { toCanonicalNimiRuntimeLocalAssetLookupKey } from '@nimiplatform/sdk/runtime';
import type {
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
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

type AssetRequirementBadgesProps = {
  modelTemplateId: string;
  relatedAssets: NimiRuntimeLocalVerifiedAssetDescriptor[];
  installedAssetsById: Map<string, NimiRuntimeLocalAssetRecord>;
  assetBusy: boolean;
  isAssetPending: (templateId: string) => boolean;
  onInstallMissingAssets: (assets: NimiRuntimeLocalVerifiedAssetDescriptor[]) => void;
  onInstallAsset: (templateId: string) => void;
};

function AssetRequirementBadges(props: AssetRequirementBadgesProps) {
  const i18n = useDesktopI18nResource().instance;
  if (props.relatedAssets.length === 0) {
    return null;
  }

  const missingAssets = props.relatedAssets.filter((asset) => (
    !props.installedAssetsById.has(toCanonicalNimiRuntimeLocalAssetLookupKey(asset.assetId))
  ));
  const hasPendingMissingAssets = missingAssets.some((asset) => props.isAssetPending(asset.templateId));

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {missingAssets.length > 1 ? (
        <button
          type="button"
          onClick={() => props.onInstallMissingAssets(props.relatedAssets)}
          disabled={props.assetBusy || hasPendingMissingAssets}
          className="inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] disabled:opacity-50"
        >
          {hasPendingMissingAssets
            ? i18n.t('runtimeConfig.localModelCenter.installingAssets', { defaultValue: 'Installing assets...' })
            : i18n.t('runtimeConfig.localModelCenter.installMissing', {
              count: missingAssets.length,
              defaultValue: 'Install Missing ({{count}})',
            })}
        </button>
      ) : null}
      {props.relatedAssets.map((asset) => {
        const installed = props.installedAssetsById.get(toCanonicalNimiRuntimeLocalAssetLookupKey(asset.assetId)) || null;
        const pending = props.isAssetPending(asset.templateId);
        return (
          <div
            key={`${props.modelTemplateId}-${asset.templateId}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
              installed
                ? 'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]'
                : 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]'
            }`}
          >
            <span>{formatAssetKindLabel(asset.kind)}</span>
            <span>
              {installed
                ? i18n.t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' })
                : pending
                  ? i18n.t('runtimeConfig.localModelCenter.installingShort', { defaultValue: 'Installing' })
                  : i18n.t('runtimeConfig.localModelCenter.required', { defaultValue: 'Required' })}
            </span>
            {!installed ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onInstallAsset(asset.templateId);
                }}
                disabled={props.assetBusy || pending}
                className="rounded-full bg-[var(--nimi-surface-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nimi-status-warning)] hover:bg-[var(--nimi-surface-card)] disabled:opacity-50"
              >
                {pending
                  ? i18n.t('runtimeConfig.localModelCenter.installing', { defaultValue: 'Installing...' })
                  : i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

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
            {i18n.t('runtimeConfig.localModelCenter.verifiedDependencyAssets', { defaultValue: 'Verified Dependency Assets' })}
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
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 text-[11px] font-semibold text-white">
                  {formatAssetKindLabel(asset.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{asset.title}</p>
                    {isRecommendedDescriptor(asset.tags) ? (
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
                        {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                      </span>
                    ) : null}
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
                      {formatAssetKindLabel(asset.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{asset.assetId}</p>
                  {asset.description ? <p className="mt-0.5 truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{asset.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => props.onInstallAsset(asset.templateId)}
                  disabled={props.assetBusy || pending}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {pending
                    ? i18n.t('runtimeConfig.localModelCenter.installing', { defaultValue: 'Installing...' })
                    : i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {props.hasSearchQuery
              ? i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsMatchSearch', { defaultValue: 'No verified dependency assets matched your search.' })
              : i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsForFilter', { defaultValue: 'No verified dependency assets available for the current filter.' })}
          </p>
        </div>
      )}
    </Surface>
  );
}

type QuickPicksSectionProps = {
  loadingVerifiedModels: boolean;
  installing: boolean;
  assetBusy: boolean;
  verifiedModels: NimiRuntimeLocalVerifiedAssetDescriptor[];
  relatedAssetsByModelTemplate: Map<string, NimiRuntimeLocalVerifiedAssetDescriptor[]>;
  installedAssetsById: Map<string, NimiRuntimeLocalAssetRecord>;
  isAssetPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onInstallAsset: (templateId: string) => void;
  onInstallMissingAssets: (assets: NimiRuntimeLocalVerifiedAssetDescriptor[]) => void;
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
          const relatedAssets = props.relatedAssetsByModelTemplate.get(item.templateId) || [];
          return (
            <div key={item.templateId} className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] p-3 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <StarIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{item.title}</p>
                  {isRecommendedDescriptor(item.tags) ? (
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
                      {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-[var(--nimi-text-muted)]">{item.assetId}</p>
                <AssetRequirementBadges
                  modelTemplateId={`${item.templateId}-quick`}
                  relatedAssets={relatedAssets}
                  installedAssetsById={props.installedAssetsById}
                  assetBusy={props.assetBusy}
                  isAssetPending={props.isAssetPending}
                  onInstallMissingAssets={props.onInstallMissingAssets}
                  onInstallAsset={props.onInstallAsset}
                />
              </div>
              <button
                type="button"
                onClick={() => props.onInstallVerifiedModel(item.templateId)}
                disabled={props.installing}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
              </button>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

export {
  AssetRequirementBadges,
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterAssetTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedAssetsSection,
};
