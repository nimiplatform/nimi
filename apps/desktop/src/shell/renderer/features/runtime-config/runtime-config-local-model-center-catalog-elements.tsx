import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
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
  INSTALL_ENGINE_OPTIONS,
  type CapabilityOption,
  type InstallEngineOption,
  formatBytes,
  normalizeInstallEngine,
} from './runtime-config-model-center-utils';
import {
  DownloadIcon,
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  StarIcon,
  isRecommendedDescriptor,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
} from './runtime-config-local-model-center-helpers';
import { AssetRequirementBadges } from './runtime-config-local-model-center-sections';

export function VerifiedModelSearchRow(props: {
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

export function CatalogVariantPicker(props: {
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
                  <RecommendationDiagnosticsPanel recommendation={variant.recommendation} className="mt-1" />
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
