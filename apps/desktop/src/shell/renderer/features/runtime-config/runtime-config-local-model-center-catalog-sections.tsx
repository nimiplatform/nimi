import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useState } from 'react';

import { Surface } from '@nimiplatform/kit/ui';
import type { NimiRuntimeLocalVerifiedAssetDescriptor } from '@nimiplatform/sdk/runtime';
import {
  DownloadIcon,
  FolderOpenIcon,
  isRecommendedDescriptor,
  localizedAssetKindLabel,
  RefreshIcon,
  StarIcon,
} from './runtime-config-local-model-center-helpers';
import {
  LocalModelCenterInProgressSection,
} from './runtime-config-local-model-center-progress-sections';
import { Button } from './runtime-config-primitives';

type VerifiedAssetsSectionProps = {
  hasSearchQuery: boolean;
  loadingVerifiedAssets: boolean;
  assetBusy: boolean;
  runtimeWritesDisabled: boolean;
  visibleVerifiedAssets: NimiRuntimeLocalVerifiedAssetDescriptor[];
  isAssetPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallAsset: (templateId: string) => void;
};

function LocalModelCenterVerifiedAssetsSection(props: VerifiedAssetsSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const [open, setOpen] = useState(false);
  // A search query means the user is looking for something: auto-expand.
  const expanded = open || props.hasSearchQuery;
  return (
    <Surface tone="card" elevation="base" padding="none" className="rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <FolderOpenIcon className="h-4 w-4 shrink-0 text-[var(--nimi-text-muted)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.verifiedAssetOffers', { defaultValue: 'Component Assets (VAE, LoRA, etc.)' })}
          </span>
          <span className="rounded-full bg-[var(--nimi-status-neutral-soft-bg)] px-2 py-0.5 text-xs font-medium text-[var(--nimi-status-neutral-soft-text)]">
            {props.visibleVerifiedAssets.length}
          </span>
          <span aria-hidden="true" className={`inline-block text-xs text-[var(--nimi-text-muted)] transition-transform ${expanded ? 'rotate-90' : ''}`}>{'▸'}</span>
        </button>
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
      {!expanded ? null : props.loadingVerifiedAssets ? (
        <div className="mt-4 py-6 text-center">
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.loadingVerifiedAssets', { defaultValue: 'Loading verified assets...' })}
          </p>
        </div>
      ) : props.visibleVerifiedAssets.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.visibleVerifiedAssets.slice(0, props.hasSearchQuery ? 12 : 6).map((asset) => {
            const pending = props.isAssetPending(asset.templateId);
            return (
              <div key={asset.templateId} className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] p-3 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--nimi-text-muted)] to-[var(--nimi-text-secondary)] text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-action-primary-text)]">
                  {localizedAssetKindLabel(asset.kind, t).slice(0, 3).toUpperCase()}
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
                      {localizedAssetKindLabel(asset.kind, t)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{asset.assetId}</p>
                  {asset.description ? <p className="mt-0.5 truncate text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{asset.description}</p> : null}
                </div>
                <Button
                  size="sm"
                  onClick={() => props.onInstallAsset(asset.templateId)}
                  disabled={props.assetBusy || pending || props.runtimeWritesDisabled}
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
        <div className="mt-4 py-6 text-center">
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {props.hasSearchQuery
              ? i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsMatchSearch', { defaultValue: 'No component assets matched your search.' })
              : i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsForFilter', { defaultValue: 'No component assets are available for the current filter.' })}
          </p>
        </div>
      )}
    </Surface>
  );
}

type QuickPicksSectionProps = {
  loadingVerifiedModels: boolean;
  installing: boolean;
  runtimeWritesDisabled: boolean;
  isModelInstalled: (assetId: string) => boolean;
  verifiedModels: NimiRuntimeLocalVerifiedAssetDescriptor[];
  onRefresh: () => void;
  onInstallCatalogQuickPick: (templateId: string) => void;
};

function QuickPicksSkeletonRows() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[0, 1, 2].map((index) => (
        <div key={`quick-pick-skeleton-${index}`} className="flex animate-pulse items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] p-3">
          <div className="h-10 w-10 rounded-lg bg-[var(--nimi-surface-panel)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-2/3 rounded bg-[var(--nimi-surface-panel)]" />
            <div className="h-2.5 w-1/2 rounded bg-[var(--nimi-surface-panel)]" />
          </div>
          <div className="h-7 w-16 rounded-lg bg-[var(--nimi-surface-panel)]" />
        </div>
      ))}
    </div>
  );
}

function LocalModelCenterQuickPicksSection(props: QuickPicksSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  // Installed picks stay visible but sink to the bottom with a disabled badge.
  const orderedModels = [
    ...props.verifiedModels.filter((item) => !props.isModelInstalled(item.assetId)),
    ...props.verifiedModels.filter((item) => props.isModelInstalled(item.assetId)),
  ].slice(0, 5);
  if (!props.loadingVerifiedModels && orderedModels.length === 0) {
    return null;
  }

  return (
    <Surface tone="card" elevation="base" padding="none" className="rounded-xl p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StarIcon className="h-4 w-4 text-[var(--nimi-status-warning)]" />
          <span className="text-sm font-semibold text-[var(--nimi-text-primary)]">
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
      {props.loadingVerifiedModels ? (
        <QuickPicksSkeletonRows />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {orderedModels.map((item) => {
            const installed = props.isModelInstalled(item.assetId);
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
                {installed ? (
                  <Button size="sm" variant="secondary" disabled>
                    {i18n.t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' })}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => props.onInstallCatalogQuickPick(item.templateId)}
                    disabled={props.installing || props.runtimeWritesDisabled}
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Surface>
  );
}

export {
  LocalModelCenterInProgressSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedAssetsSection,
};
