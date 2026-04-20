import type {
  GgufVariantDescriptor,
  LocalRuntimeAssetRecord,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeVerifiedAssetDescriptor,
} from '@runtime/local-runtime';
import { i18n } from '@renderer/i18n';
import { RuntimeSelect } from './runtime-config-primitives';
import {
  CAPABILITY_OPTIONS,
  type CapabilityOption,
  type InstallEngineOption,
} from './runtime-config-model-center-utils';
import {
  DownloadIcon,
  ModelIcon,
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  recommendationConfidenceLabel,
  recommendationHostSupportLabel,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
  SearchIcon,
} from './runtime-config-local-model-center-helpers';
import { CatalogVariantPicker, VerifiedModelSearchRow } from './runtime-config-local-model-center-catalog-elements';

type CatalogCardProps = {
  searchQuery: string;
  catalogCapability: 'all' | CapabilityOption;
  loadingCatalog: boolean;
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

export function LocalModelCenterCatalogCard(props: CatalogCardProps) {
  return (
    <div className="overflow-visible rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
      <div className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-5 py-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] text-[var(--nimi-action-primary-bg)]">
            <SearchIcon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {i18n.t('runtimeConfig.localModelCenter.modelCatalog', { defaultValue: 'Model Catalog' })}
          </h3>
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
