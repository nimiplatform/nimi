import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { ScrollArea } from '@nimiplatform/kit/ui';
import type {
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalCatalogItemDescriptor,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';

import { Button } from './runtime-config-primitives';
import {
  type CapabilityOption,
  formatBytes,
} from './runtime-config-model-center-utils';
import {
  DownloadIcon,
  localizedAssetKindLabel,
  RecommendationDetailList,
  RecommendationDiagnosticsPanel,
  StarIcon,
  isRecommendedDescriptor,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
} from './runtime-config-local-model-center-helpers';
export function VerifiedModelSearchRow(props: {
  item: NimiRuntimeLocalVerifiedAssetDescriptor;
  installing: boolean;
  installed?: boolean;
  runtimeWritesDisabled: boolean;
  onInstallCatalogQuickPick: (templateId: string) => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--nimi-status-warning)] to-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
        <StarIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{props.item.title}</span>
          {isRecommendedDescriptor(props.item.tags) ? (
            <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]">
              {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
            </span>
          ) : null}
          <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]">
            {i18n.t('runtimeConfig.localModelCenter.verified', { defaultValue: 'Verified' })}
          </span>
        </div>
        <p className="truncate text-xs text-[var(--nimi-text-muted)]">{props.item.assetId}</p>
        {props.item.description ? <p className="mt-0.5 line-clamp-1 text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{props.item.description}</p> : null}
      </div>
      {props.installed ? (
        <Button size="sm" variant="secondary" disabled>
          {i18n.t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' })}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => props.onInstallCatalogQuickPick(props.item.templateId)}
          disabled={props.installing || props.runtimeWritesDisabled}
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
        </Button>
      )}
    </div>
  );
}

export function CatalogVariantPicker(props: {
  item: NimiRuntimeLocalCatalogItemDescriptor;
  variantList: NimiRuntimeLocalCatalogVariantDescriptor[];
  variantError: string;
  loadingVariants: boolean;
  selectedCapability: CapabilityOption;
  installing: boolean;
  runtimeWritesDisabled: boolean;
  onClose: () => void;
  onInstallVariant: (filename: string) => void;
}) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const engineLabel = String(props.item.engine || '').trim()
    || t('runtimeConfig.localModelCenter.runtimeCatalogDefault', { defaultValue: 'Runtime catalog default' });
  const orderedVariants = [
    ...props.variantList.filter((variant) => variant.recommendation?.tier === 'recommended'),
    ...props.variantList.filter((variant) => variant.recommendation?.tier !== 'recommended'),
  ];
  return (
    <div className="bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))]/80 px-4 pb-3">
      <div className="overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
        <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] px-3 py-2">
          <span className="text-xs font-semibold text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.selectVariant', { defaultValue: 'Select Variant' })}
          </span>
          <button type="button" onClick={props.onClose} className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] hover:text-[var(--nimi-text-secondary)]">
            {i18n.t('Common.close', { defaultValue: 'Close' })}
          </button>
        </div>
        <div className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-panel))] px-3 py-3">
          <p className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.localModelCenter.variantSpecSummary', {
              capability: localizedAssetKindLabel(props.selectedCapability, t),
              engine: engineLabel,
              defaultValue: 'Capability: {{capability}} · Engine: {{engine}}',
            })}
          </p>
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
          <ScrollArea className="max-h-48 divide-y divide-[var(--nimi-border-subtle)]" viewportClassName="max-h-48">
            {orderedVariants.map((variant) => (
              <button
                key={variant.filename}
                type="button"
                disabled={props.installing || props.runtimeWritesDisabled}
                onClick={() => props.onInstallVariant(variant.filename)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-[var(--nimi-text-primary)]">{variant.filename}</span>
                    {variant.recommendation ? (
                      <span className={`rounded px-1.5 py-0.5 text-[length:var(--nimi-type-caption-size)] ${recommendationTierClass(variant.recommendation.tier)}`}>
                        {recommendationTierLabel(variant.recommendation.tier, t)}
                      </span>
                    ) : null}
                  </div>
                  {variant.recommendation ? (
                    <p className="mt-1 truncate text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                      {recommendationSummary(variant.recommendation, t)}
                    </p>
                  ) : null}
                  <RecommendationDetailList
                    recommendation={variant.recommendation}
                    className="mt-1 space-y-0.5"
                    rowClassName="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]"
                    labelClassName="font-medium text-[var(--nimi-text-secondary)]"
                    maxFallbackEntries={2}
                  />
                  <RecommendationDiagnosticsPanel recommendation={variant.recommendation} className="mt-1" />
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <p className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{variant.format}</p>
                  {typeof variant.sizeBytes === 'number' ? (
                    <p className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{formatBytes(variant.sizeBytes)}</p>
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
