import { useState } from 'react';
import type {
  LocalRuntimeAssetKind,
  LocalRuntimeAssetRecord,
} from '@runtime/local-runtime';
import { i18n } from '@renderer/i18n';
import { RuntimeSelect } from './runtime-config-primitives';
import {
  localSpeechReasonSummary,
} from './runtime-config-model-center-utils';
import {
  ASSET_KIND_OPTIONS,
  FolderOpenIcon,
  formatAssetKindLabel,
  ModelIcon,
  PackageIcon,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
  RefreshIcon,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';

type InstalledAssetsSectionProps = {
  filteredInstalledRunnableAssets: LocalRuntimeAssetRecord[];
  filteredInstalledDependencyAssets: LocalRuntimeAssetRecord[];
  loadingInstalledAssets: boolean;
  loadingVerifiedAssets: boolean;
  assetKindFilter: 'all' | LocalRuntimeAssetKind;
  assetBusy: boolean;
  onArtifactKindFilterChange: (value: 'all' | LocalRuntimeAssetKind) => void;
  onRefreshAssets: () => void;
  onRemoveAsset: (localAssetId: string) => void;
  onRepairAsset: (localAssetId: string, endpoint: string) => void;
  onRescanAsset: (localAssetId: string) => void;
};

function defaultManagedEndpointForEngine(engine: string): string {
  const normalized = String(engine || '').trim().toLowerCase();
  if (normalized === 'media') {
    return 'http://127.0.0.1:8321/v1';
  }
  if (normalized === 'speech') {
    return 'http://127.0.0.1:8330/v1';
  }
  return '';
}

function assetNeedsAttachedEndpointRepair(asset: LocalRuntimeAssetRecord): boolean {
  const engine = String(asset.engine || '').trim().toLowerCase();
  if (engine !== 'media' && engine !== 'speech') {
    return false;
  }
  if (asset.engineRuntimeMode !== 'attached-endpoint') {
    return false;
  }
  const defaultEndpoint = defaultManagedEndpointForEngine(engine);
  const currentEndpoint = String(asset.endpoint || '').trim().replace(/\/+$/, '');
  if (!defaultEndpoint || currentEndpoint !== defaultEndpoint.replace(/\/+$/, '')) {
    return false;
  }
  return String(asset.source.repo || '').trim().toLowerCase().startsWith('file://');
}

function assetSupportsBundleRescan(asset: LocalRuntimeAssetRecord): boolean {
  return String(asset.source.repo || '').trim().toLowerCase().startsWith('file://');
}

export function LocalModelCenterInstalledAssetsSection(props: InstalledAssetsSectionProps) {
  const [confirmRemoveAssetId, setConfirmRemoveAssetId] = useState('');
  const [repairAssetId, setRepairAssetId] = useState('');
  const [repairEndpoint, setRepairEndpoint] = useState('');

  const runnableCount = props.filteredInstalledRunnableAssets.length;
  const dependencyCount = props.filteredInstalledDependencyAssets.length;
  const totalCount = runnableCount + dependencyCount;

  return (
    <div className="overflow-visible rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
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
            onChange={(next) => props.onArtifactKindFilterChange((next || 'all') as 'all' | LocalRuntimeAssetKind)}
            className="w-36"
            options={[
              {
                value: 'all',
                label: i18n.t('runtimeConfig.localModelCenter.allKinds', { defaultValue: 'All Kinds' }),
              },
              ...ASSET_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatAssetKindLabel(kind) })),
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
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledRunnableAssets.map((asset) => {
              const needsRepair = assetNeedsAttachedEndpointRepair(asset);
              const isRepairing = repairAssetId === asset.localAssetId;
              const supportsRescan = assetSupportsBundleRescan(asset);
              const unhealthyReasonSummary = asset.status === 'unhealthy'
                ? localSpeechReasonSummary(asset.reasonCode)
                : '';
              return (
              <div key={asset.localAssetId} className="px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]">
                <div className="flex items-center gap-3">
                  <ModelIcon engine={asset.engine} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{asset.assetId}</span>
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{asset.engine}</span>
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-action-primary-bg)]">
                        {formatAssetKindLabel(asset.kind)}
                      </span>
                      {asset.recommendation ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(asset.recommendation.tier)}`}>
                          {recommendationTierLabel(asset.recommendation.tier)}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-[var(--nimi-text-muted)]">{asset.localAssetId}</p>
                    {asset.recommendation ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-text-muted)]">
                        {recommendationSummary(asset.recommendation)}
                      </p>
                    ) : null}
                    {asset.status === 'unhealthy' && String(asset.healthDetail || '').trim() ? (
                      <p className="mt-1 line-clamp-3 text-[11px] text-[var(--nimi-status-danger)]">
                        {String(asset.healthDetail || '').trim()}
                      </p>
                    ) : null}
                    {asset.status === 'unhealthy' && String(asset.reasonCode || '').trim() ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-status-danger)]">
                        {unhealthyReasonSummary || `reason=${String(asset.reasonCode || '').trim()}`}
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(asset.capabilities || []).slice(0, 3).map((capability) => (
                        <span key={capability} className="rounded border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-action-primary-bg)]">{capability}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] ${
                      asset.status === 'active' ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : asset.status === 'unhealthy' ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]'
                    }`}>
                      {asset.status === 'installed'
                        ? i18n.t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' })
                        : asset.status}
                    </span>
                    {needsRepair ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmRemoveAssetId('');
                          setRepairAssetId(asset.localAssetId);
                          setRepairEndpoint('');
                        }}
                        disabled={props.assetBusy}
                        className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-status-warning)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,transparent)] disabled:opacity-50"
                      >
                        {i18n.t('runtimeConfig.localModelCenter.repair', { defaultValue: 'Repair' })}
                      </button>
                    ) : null}
                    {supportsRescan ? (
                      <button
                        type="button"
                        onClick={() => props.onRescanAsset(asset.localAssetId)}
                        disabled={props.assetBusy}
                        className="rounded-lg border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
                      >
                        {i18n.t('runtimeConfig.localModelCenter.rescanBundle', { defaultValue: 'Re-scan Bundle' })}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveAssetId(asset.localAssetId)}
                      disabled={props.assetBusy || confirmRemoveAssetId === asset.localAssetId}
                      className="rounded-lg p-1.5 text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
                      title={i18n.t('runtimeConfig.localModelCenter.remove', { defaultValue: 'Remove' })}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {isRepairing ? (
                  <div className="mt-2 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] px-4 py-3">
                    <p className="text-xs text-[var(--nimi-status-warning)]">
                      {String(asset.healthDetail || '').trim() || i18n.t('runtimeConfig.localModelCenter.repairAttachedEndpointHint', {
                        defaultValue: 'This asset must be rebound to an external attached endpoint on the current host.',
                      })}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="text"
                        value={repairEndpoint}
                        onChange={(event) => setRepairEndpoint(event.target.value)}
                        placeholder={i18n.t('runtimeConfig.localModelCenter.repairEndpointPlaceholder', { defaultValue: 'http://host:port/v1' })}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 text-xs text-[var(--nimi-text-primary)] outline-none focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void Promise.resolve(props.onRepairAsset(asset.localAssetId, repairEndpoint)).then(() => {
                            setRepairAssetId('');
                            setRepairEndpoint('');
                          });
                        }}
                        disabled={props.assetBusy || !String(repairEndpoint || '').trim()}
                        className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)] disabled:opacity-50"
                      >
                        {i18n.t('runtimeConfig.localModelCenter.confirmRepair', { defaultValue: 'Apply' })}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRepairAssetId('');
                          setRepairEndpoint('');
                        }}
                        className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
                      >
                        {i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
                      </button>
                    </div>
                  </div>
                ) : null}
                {confirmRemoveAssetId === asset.localAssetId ? (
                  <div className="mt-2 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2.5">
                    <p className="flex-1 text-xs text-[var(--nimi-status-danger)]">
                      {i18n.t('runtimeConfig.localModelCenter.confirmRemoveAsset', {
                        defaultValue: 'Remove "{{name}}"? Asset files will be permanently deleted.',
                        name: asset.assetId,
                      })}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmRemoveAssetId('');
                        setRepairAssetId('');
                        props.onRemoveAsset(asset.localAssetId);
                      }}
                      disabled={props.assetBusy}
                      className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] disabled:opacity-50"
                    >
                      {i18n.t('runtimeConfig.localModelCenter.confirm', { defaultValue: 'Confirm' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveAssetId('')}
                      className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
                    >
                      {i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
                    </button>
                  </div>
                ) : null}
              </div>
            );})}
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
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledDependencyAssets.map((asset) => {
              const unhealthyReasonSummary = asset.status === 'unhealthy'
                ? localSpeechReasonSummary(asset.reasonCode)
                : '';
              return (
              <div key={asset.localAssetId} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)]">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[11px] font-semibold text-[var(--nimi-text-secondary)]">
                  {formatAssetKindLabel(asset.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{asset.assetId}</span>
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
                      {formatAssetKindLabel(asset.kind)}
                    </span>
                    <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{asset.engine}</span>
                  </div>
                  <p className="truncate text-xs text-[var(--nimi-text-muted)]">{asset.localAssetId}</p>
                  <p className="truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{asset.entry}</p>
                  {asset.status === 'unhealthy' && String(asset.healthDetail || '').trim() ? (
                    <p className="mt-1 line-clamp-3 text-[11px] text-[var(--nimi-status-danger)]">
                      {String(asset.healthDetail || '').trim()}
                    </p>
                  ) : null}
                  {asset.status === 'unhealthy' && String(asset.reasonCode || '').trim() ? (
                    <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-status-danger)]">
                      {unhealthyReasonSummary || `reason=${String(asset.reasonCode || '').trim()}`}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] ${
                    asset.status === 'active' ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : asset.status === 'unhealthy' ? 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] text-[var(--nimi-status-danger)]' : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-muted)]'
                  }`}>
                    {asset.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveAssetId(asset.localAssetId)}
                    disabled={props.assetBusy || confirmRemoveAssetId === asset.localAssetId}
                    className="rounded-lg p-1.5 text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] disabled:opacity-50"
                    title={i18n.t('runtimeConfig.localModelCenter.removeAsset', { defaultValue: 'Remove asset' })}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                {confirmRemoveAssetId === asset.localAssetId ? (
                  <div className="mt-2 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-4 py-2.5">
                    <p className="flex-1 text-xs text-[var(--nimi-status-danger)]">
                      {i18n.t('runtimeConfig.localModelCenter.confirmRemoveAsset', {
                        defaultValue: 'Remove "{{name}}"? Asset files will be permanently deleted.',
                        name: asset.assetId,
                      })}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmRemoveAssetId('');
                        props.onRemoveAsset(asset.localAssetId);
                      }}
                      disabled={props.assetBusy}
                      className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-danger)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)] disabled:opacity-50"
                    >
                      {i18n.t('runtimeConfig.localModelCenter.confirm', { defaultValue: 'Confirm' })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveAssetId('')}
                      className="rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
                    >
                      {i18n.t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
                    </button>
                  </div>
                ) : null}
              </div>
              );
            })}
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
