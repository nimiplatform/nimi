import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useState } from 'react';
import type {
  NimiRuntimeLocalAssetKind,
  NimiRuntimeLocalAssetRecord,
} from '@nimiplatform/sdk/runtime';

import { RuntimeSelect } from './runtime-config-primitives';
import {
  ASSET_KIND_OPTIONS,
  FolderOpenIcon,
  localizedAssetKindLabel,
  PackageIcon,
  RefreshIcon,
} from './runtime-config-local-model-center-helpers';
import {
  DependencyInstalledAssetRow,
  RunnableInstalledAssetRow,
} from './runtime-config-local-model-center-installed-rows';

type InstalledAssetsSectionProps = {
  filteredInstalledRunnableAssets: NimiRuntimeLocalAssetRecord[];
  filteredInstalledDependencyAssets: NimiRuntimeLocalAssetRecord[];
  loadingInstalledAssets: boolean;
  loadingVerifiedAssets: boolean;
  assetKindFilter: 'all' | NimiRuntimeLocalAssetKind;
  assetBusy: boolean;
  onArtifactKindFilterChange: (value: 'all' | NimiRuntimeLocalAssetKind) => void;
  onRefreshAssets: () => void;
  onRemoveAsset: (localAssetId: string) => void;
  onRescanAsset: (localAssetId: string) => void;
};

export function LocalModelCenterInstalledAssetsSection(props: InstalledAssetsSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  const [confirmRemoveAssetId, setConfirmRemoveAssetId] = useState('');

  const runnableCount = props.filteredInstalledRunnableAssets.length;
  const dependencyCount = props.filteredInstalledDependencyAssets.length;
  const totalCount = runnableCount + dependencyCount;

  return (
    <div className="overflow-visible rounded-2xl bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)] ring-1 ring-[var(--nimi-border-subtle)]">
      <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]">
            <PackageIcon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {i18n.t('runtimeConfig.localModelCenter.myModels', { defaultValue: 'My Models' })}
          </h3>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-status-success)]">
            {totalCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <RuntimeSelect
            value={props.assetKindFilter}
            onChange={(next) => props.onArtifactKindFilterChange((next || 'all') as 'all' | NimiRuntimeLocalAssetKind)}
            className="w-36"
            options={[
              {
                value: 'all',
                label: i18n.t('runtimeConfig.localModelCenter.allKinds', { defaultValue: 'All Kinds' }),
              },
              ...ASSET_KIND_OPTIONS.map((kind) => ({ value: kind, label: localizedAssetKindLabel(kind, i18n.t.bind(i18n)) })),
            ]}
          />
          <button
            type="button"
            onClick={props.onRefreshAssets}
            disabled={props.loadingInstalledAssets || props.loadingVerifiedAssets || props.assetBusy}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] disabled:opacity-50"
          >
            <RefreshIcon className="h-3 w-3" />
            {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-5 py-2">
          <PackageIcon className="h-4 w-4 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.installedCount', {
              count: runnableCount,
              defaultValue: 'Installed ({{count}})',
            })}
          </span>
        </div>
        {runnableCount > 0 ? (
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            {props.filteredInstalledRunnableAssets.map((asset) => (
              <RunnableInstalledAssetRow
                key={asset.localAssetId}
                asset={asset}
                assetBusy={props.assetBusy}
                confirmRemoveAssetId={confirmRemoveAssetId}
                onCancelRemove={() => setConfirmRemoveAssetId('')}
                onConfirmRemove={(localAssetId) => {
                  setConfirmRemoveAssetId('');
                  props.onRemoveAsset(localAssetId);
                }}
                onRequestRemove={(localAssetId) => setConfirmRemoveAssetId(localAssetId)}
                onRescanAsset={props.onRescanAsset}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
              <PackageIcon className="h-6 w-6" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.localModelCenter.noInstalledModels', { defaultValue: 'No Installed Models' })}
            </h3>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--nimi-border-subtle)]">
        <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-5 py-2">
          <div className="flex items-center gap-2">
            <FolderOpenIcon className="h-4 w-4 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.dependencyAssetsCount', {
                count: dependencyCount,
                defaultValue: 'Dependency Assets ({{count}})',
              })}
            </span>
          </div>
        </div>
        {props.loadingInstalledAssets ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.loadingCompanionAssets', { defaultValue: 'Loading dependency assets...' })}
            </p>
          </div>
        ) : dependencyCount > 0 ? (
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            {props.filteredInstalledDependencyAssets.map((asset) => (
              <DependencyInstalledAssetRow
                key={asset.localAssetId}
                asset={asset}
                assetBusy={props.assetBusy}
                confirmRemoveAssetId={confirmRemoveAssetId}
                onCancelRemove={() => setConfirmRemoveAssetId('')}
                onConfirmRemove={(localAssetId) => {
                  setConfirmRemoveAssetId('');
                  props.onRemoveAsset(localAssetId);
                }}
                onRequestRemove={(localAssetId) => setConfirmRemoveAssetId(localAssetId)}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
              <FolderOpenIcon className="h-6 w-6" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.localModelCenter.noDependencyAssets', { defaultValue: 'No Dependency Assets' })}
            </h3>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.noDependencyAssetsDescription', {
                defaultValue: 'Import `asset.manifest.json` files or install verified dependency assets below.',
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
