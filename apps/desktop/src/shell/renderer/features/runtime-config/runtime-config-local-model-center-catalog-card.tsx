import { useState } from 'react';
import type {
  GgufVariantDescriptor,
  LocalRuntimeAssetKind,
  LocalRuntimeAssetRecord,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeVerifiedAssetDescriptor,
} from '@runtime/local-runtime';
import { i18n } from '@renderer/i18n';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { RuntimeSelect } from './runtime-config-primitives';
import {
  CAPABILITY_OPTIONS,
  INSTALL_ENGINE_OPTIONS,
  type CapabilityOption,
  type InstallEngineOption,
  formatBytes,
  normalizeInstallEngine,
} from './runtime-config-model-center-utils';
import {
  ASSET_KIND_OPTIONS,
  DownloadIcon,
  FolderOpenIcon,
  formatAssetKindLabel,
  isRecommendedDescriptor,
  ModelIcon,
  PackageIcon,
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  recommendationConfidenceLabel,
  recommendationHostSupportLabel,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
  RefreshIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';
import { AssetRequirementBadges } from './runtime-config-local-model-center-sections';

type CatalogCardProps = {
  searchQuery: string;
  catalogCapability: 'all' | CapabilityOption;
  filteredInstalledRunnableAssets: LocalRuntimeAssetRecord[];
  filteredInstalledDependencyAssets: LocalRuntimeAssetRecord[];
  loadingCatalog: boolean;
  loadingInstalledAssets: boolean;
  loadingVerifiedAssets: boolean;
  assetKindFilter: 'all' | LocalRuntimeAssetKind;
  assetBusy: boolean;
  hasSearchQuery: boolean;
  verifiedModels: LocalRuntimeVerifiedAssetDescriptor[];
  catalogItems: LocalRuntimeCatalogItemDescriptor[];
  catalogDisplayCount: number;
  relatedAssetsByModelTemplate: Map<string, LocalRuntimeVerifiedAssetDescriptor[]>;
  installedAssetsById: Map<string, LocalRuntimeAssetRecord>;
  variantPickerItem: LocalRuntimeCatalogItemDescriptor | null;
  variantList: GgufVariantDescriptor[];
  variantError: string;
  loadingVariants: boolean;
  selectedCatalogCapability: (item: LocalRuntimeCatalogItemDescriptor) => CapabilityOption;
  selectedCatalogEngine: (item: LocalRuntimeCatalogItemDescriptor) => InstallEngineOption;
  isAssetPending: (templateId: string) => boolean;
  onSearchQueryChange: (value: string) => void;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onArtifactKindFilterChange: (value: 'all' | LocalRuntimeAssetKind) => void;
  onRefreshAssets: () => void;
  onRemoveAsset: (localAssetId: string) => void;
  onInstallMissingAssets: (assets: LocalRuntimeVerifiedAssetDescriptor[]) => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onInstallAsset: (templateId: string) => void;
  onToggleVariantPicker: (item: LocalRuntimeCatalogItemDescriptor) => void;
  onCloseVariantPicker: () => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onCatalogEngineOverrideChange: (itemId: string, engine: InstallEngineOption) => void;
  onInstallCatalogVariant: (item: LocalRuntimeCatalogItemDescriptor, variantFilename: string) => void;
  onLoadMoreCatalog: () => void;
  installing: boolean;
};

function VerifiedModelSearchRow(props: {
  item: LocalRuntimeVerifiedAssetDescriptor;
  relatedAssets: LocalRuntimeVerifiedAssetDescriptor[];
  installedAssetsById: Map<string, LocalRuntimeAssetRecord>;
  assetBusy: boolean;
  installing: boolean;
  isAssetPending: (templateId: string) => boolean;
  onInstallMissingAssets: (assets: LocalRuntimeVerifiedAssetDescriptor[]) => void;
  onInstallAsset: (templateId: string) => void;
  onInstallVerifiedModel: (templateId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
        <StarIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{props.item.title}</span>
          {isRecommendedDescriptor(props.item.tags) ? (
            <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
              {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
            </span>
          ) : null}
          <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-warning)]">
            {i18n.t('runtimeConfig.localModelCenter.verified', { defaultValue: 'Verified' })}
          </span>
        </div>
        <p className="truncate text-xs text-[var(--nimi-text-muted)]">{props.item.assetId}</p>
        {props.item.description ? <p className="mt-0.5 line-clamp-1 text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{props.item.description}</p> : null}
        <AssetRequirementBadges
          modelTemplateId={props.item.templateId}
          relatedAssets={props.relatedAssets}
          installedAssetsById={props.installedAssetsById}
          assetBusy={props.assetBusy}
          isAssetPending={props.isAssetPending}
          onInstallMissingAssets={props.onInstallMissingAssets}
          onInstallAsset={props.onInstallAsset}
        />
      </div>
      <button
        type="button"
        onClick={() => props.onInstallVerifiedModel(props.item.templateId)}
        disabled={props.installing}
        className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
      </button>
    </div>
  );
}

function CatalogVariantPicker(props: {
  item: LocalRuntimeCatalogItemDescriptor;
  variantList: GgufVariantDescriptor[];
  variantError: string;
  loadingVariants: boolean;
  selectedCapability: CapabilityOption;
  selectedEngine: InstallEngineOption;
  installing: boolean;
  onClose: () => void;
  onCapabilityChange: (capability: CapabilityOption) => void;
  onEngineChange: (engine: InstallEngineOption) => void;
  onInstallVariant: (filename: string) => void;
}) {
  return (
    <div className="bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/80 px-4 pb-3">
      <div className="overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)] bg-white">
        <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-3 py-2">
          <span className="text-xs font-semibold text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.selectVariant', { defaultValue: 'Select Variant' })}
          </span>
          <button type="button" onClick={props.onClose} className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] hover:text-[var(--nimi-text-secondary)]">
            {i18n.t('Common.close', { defaultValue: 'Close' })}
          </button>
        </div>
        <div className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-panel))] px-3 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.capability', { defaultValue: 'Capability' })}
              </p>
              <RuntimeSelect
                value={props.selectedCapability}
                onChange={(next) => props.onCapabilityChange((next || 'chat') as CapabilityOption)}
                className="w-full"
                options={CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability }))}
              />
              <p className="mt-1 text-[10px] text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.detectedValue', {
                  value: (props.item.capabilities.length > 0 ? props.item.capabilities : ['chat']).join(', '),
                  defaultValue: 'Detected: {{value}}',
                })}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.engine', { defaultValue: 'Engine' })}
              </p>
              <RuntimeSelect
                value={props.selectedEngine}
                onChange={(next) => props.onEngineChange(normalizeInstallEngine(next))}
                className="w-full"
                options={INSTALL_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine }))}
              />
              <p className="mt-1 text-[10px] text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.detectedValue', {
                  value: normalizeInstallEngine(props.item.engine),
                  defaultValue: 'Detected: {{value}}',
                })}
              </p>
            </div>
          </div>
        </div>
        {props.loadingVariants ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.loadingVariants', { defaultValue: 'Loading variants...' })}
            </p>
          </div>
        ) : props.variantList.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {props.variantError
                ? i18n.t('runtimeConfig.localModelCenter.variantError', {
                  error: props.variantError,
                  defaultValue: 'Error: {{error}}',
                })
                : i18n.t('runtimeConfig.localModelCenter.noVariantsFound', { defaultValue: 'No GGUF variants found' })}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-48 divide-y divide-gray-100" viewportClassName="max-h-48">
            {props.variantList.map((variant) => (
              <button
                key={variant.filename}
                type="button"
                disabled={props.installing}
                onClick={() => props.onInstallVariant(variant.filename)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-[var(--nimi-text-primary)]">{variant.filename}</span>
                    {variant.recommendation ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(variant.recommendation.tier)}`}>
                        {recommendationTierLabel(variant.recommendation.tier)}
                      </span>
                    ) : null}
                  </div>
                  {variant.recommendation ? (
                    <p className="mt-1 truncate text-[10px] text-[var(--nimi-text-muted)]">
                      {recommendationSummary(variant.recommendation)}
                    </p>
                  ) : null}
                  <RecommendationDetailList
                    recommendation={variant.recommendation}
                    className="mt-1 space-y-0.5"
                    rowClassName="text-[10px] text-[var(--nimi-text-muted)]"
                    labelClassName="font-medium text-[var(--nimi-text-secondary)]"
                    maxFallbackEntries={2}
                  />
                  <RecommendationDiagnosticsPanel
                    recommendation={variant.recommendation}
                    className="mt-1"
                  />
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <p className="text-[10px] text-[var(--nimi-text-muted)]">{variant.format}</p>
                  {typeof variant.sizeBytes === 'number' ? (
                    <p className="text-[10px] text-[var(--nimi-text-muted)]">{formatBytes(variant.sizeBytes)}</p>
                  ) : null}
                </div>
              </button>
            ))}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

export function LocalModelCenterCatalogCard(props: CatalogCardProps) {
  const [confirmRemoveAssetId, setConfirmRemoveAssetId] = useState('');

  return (
    <div className="overflow-visible rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
      <div className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]">
            <SearchIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.localModelCenter.modelCatalog', { defaultValue: 'Model Catalog' })}
            </h3>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.modelCatalogDescription', {
                defaultValue: 'Search and install from Hugging Face or verified models',
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
            <input
              type="text"
              value={props.searchQuery}
              onChange={(event) => props.onSearchQueryChange(event.target.value)}
              placeholder={i18n.t('runtimeConfig.localModelCenter.searchModelsPlaceholder', { defaultValue: 'Search models by name, repo, or task...' })}
              className="h-10 w-full rounded-lg border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] pl-9 pr-4 text-sm outline-none focus:border-[var(--nimi-field-focus)] focus:bg-white focus:ring-2 focus:ring-mint-100"
            />
          </div>
          <RuntimeSelect
            value={props.catalogCapability}
            onChange={(nextCapability) => props.onCatalogCapabilityChange((nextCapability || 'all') as 'all' | CapabilityOption)}
            className="w-52"
            options={[
              {
                value: 'all',
                label: i18n.t('runtimeConfig.localModelCenter.allCapabilities', { defaultValue: 'All Capabilities' }),
              },
              ...CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability })),
            ]}
          />
        </div>
      </div>

      <div className="rounded-b-xl bg-white/60">
        <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-2">
          <PackageIcon className="h-4 w-4 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.installedCount', {
              count: props.filteredInstalledRunnableAssets.length,
              defaultValue: 'Installed ({{count}})',
            })}
          </span>
        </div>
        {props.filteredInstalledRunnableAssets.length > 0 ? (
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledRunnableAssets.map((asset) => (
              <div key={asset.localAssetId} className="px-4 py-3 transition-colors hover:bg-white">
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

      <div className="border-t border-[var(--nimi-border-subtle)] bg-white/60">
        <div className="flex items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-2">
          <div className="flex items-center gap-2">
            <FolderOpenIcon className="h-4 w-4 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.dependencyAssetsCount', {
                count: props.filteredInstalledDependencyAssets.length,
                defaultValue: 'Dependency Assets ({{count}})',
              })}
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
              className="flex items-center gap-1.5 rounded border border-[var(--nimi-border-subtle)] px-2 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
            >
              <RefreshIcon className="h-3 w-3" />
              {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
        </div>
        {props.loadingInstalledAssets ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.loadingCompanionAssets', { defaultValue: 'Loading dependency assets...' })}
            </p>
          </div>
        ) : props.filteredInstalledDependencyAssets.length > 0 ? (
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledDependencyAssets.map((asset) => (
              <div key={asset.localAssetId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
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

      {props.hasSearchQuery ? (
        <div className="border-t border-[var(--nimi-border-subtle)] bg-white/60">
          <div className="border-b border-[var(--nimi-border-subtle)] bg-white/70 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.availableToInstall', { defaultValue: 'Available to Install' })}
            </span>
          </div>
          <div className="divide-y divide-gray-200/80">
            {props.verifiedModels.map((item) => (
              <VerifiedModelSearchRow
                key={item.templateId}
                item={item}
                relatedAssets={props.relatedAssetsByModelTemplate.get(item.templateId) || []}
                installedAssetsById={props.installedAssetsById}
                assetBusy={props.assetBusy}
                installing={props.installing}
                isAssetPending={props.isAssetPending}
                onInstallMissingAssets={props.onInstallMissingAssets}
                onInstallAsset={props.onInstallAsset}
                onInstallVerifiedModel={props.onInstallVerifiedModel}
              />
            ))}
            {props.catalogItems.slice(0, props.catalogDisplayCount).map((item) => (
              <div key={item.itemId}>
                <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                  <ModelIcon engine={item.engine} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{item.title || item.modelId}</span>
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">{item.engine}</span>
                      <span className="rounded bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-action-primary-bg)]">
                        {i18n.t('runtimeConfig.localModelCenter.huggingFace', { defaultValue: 'Hugging Face' })}
                      </span>
                      {item.recommendation ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${recommendationTierClass(item.recommendation.tier)}`}>
                          {recommendationTierLabel(item.recommendation.tier)}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-[var(--nimi-text-muted)]">{item.modelId}</p>
                    {item.recommendation ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--nimi-text-muted)]">
                        {recommendationSummary(item.recommendation)}
                      </p>
                    ) : null}
                    <RecommendationDetailList
                      recommendation={item.recommendation}
                      className="mt-1 space-y-0.5"
                      rowClassName="text-[10px] text-[var(--nimi-text-muted)]"
                      labelClassName="font-medium text-[var(--nimi-text-secondary)]"
                      maxFallbackEntries={2}
                    />
                    <RecommendationDiagnosticsPanel
                      recommendation={item.recommendation}
                      className="mt-1"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(item.capabilities.length > 0 ? item.capabilities : ['chat']).map((capability) => (
                        <span key={`${item.itemId}-${capability}`} className="rounded border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-secondary)]">
                          {capability}
                        </span>
                      ))}
                      {item.recommendation?.hostSupportClass ? (
                        <span className="rounded border border-[color-mix(in_srgb,var(--nimi-status-info)_22%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--nimi-status-info)]">
                          {recommendationHostSupportLabel(item.recommendation.hostSupportClass)}
                        </span>
                      ) : null}
                      {item.recommendation?.confidence ? (
                        <span className="rounded border border-[var(--nimi-border-subtle)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">
                          {recommendationConfidenceLabel(item.recommendation.confidence)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${item.installAvailable ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]'}`}>
                    {item.installAvailable
                      ? i18n.t('runtimeConfig.localModelCenter.ready', { defaultValue: 'Ready' })
                      : i18n.t('runtimeConfig.localModelCenter.manual', { defaultValue: 'Manual' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onToggleVariantPicker(item)}
                    disabled={!item.installAvailable || props.installing}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
                  </button>
                </div>
                {props.variantPickerItem?.itemId === item.itemId ? (
                  <CatalogVariantPicker
                    item={item}
                    variantList={props.variantList}
                    variantError={props.variantError}
                    loadingVariants={props.loadingVariants}
                    selectedCapability={props.selectedCatalogCapability(item)}
                    selectedEngine={props.selectedCatalogEngine(item)}
                    installing={props.installing}
                    onClose={props.onCloseVariantPicker}
                    onCapabilityChange={(capability) => props.onCatalogCapabilityOverrideChange(item.itemId, capability)}
                    onEngineChange={(engine) => props.onCatalogEngineOverrideChange(item.itemId, engine)}
                    onInstallVariant={(filename) => props.onInstallCatalogVariant(item, filename)}
                  />
                ) : null}
              </div>
            ))}
          </div>
          {props.catalogItems.length > props.catalogDisplayCount ? (
            <div className="border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-4 py-3 text-center">
              <button
                type="button"
                onClick={props.onLoadMoreCatalog}
                className="rounded-lg border border-[var(--nimi-border-subtle)] px-4 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]"
              >
                {i18n.t('runtimeConfig.localModelCenter.loadMore', {
                  count: props.catalogItems.length - props.catalogDisplayCount,
                  defaultValue: 'Load More ({{count}} remaining)',
                })}
              </button>
            </div>
          ) : null}
          {props.catalogItems.length === 0 && props.verifiedModels.length === 0 && !props.loadingCatalog ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.noModelsMatchingSearch', { defaultValue: 'No models found matching your search' })}
              </p>
            </div>
          ) : null}
          {props.loadingCatalog ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.searching', { defaultValue: 'Searching...' })}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
