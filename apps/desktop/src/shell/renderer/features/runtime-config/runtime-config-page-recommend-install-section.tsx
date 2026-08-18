import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface, cn } from '@nimiplatform/kit/ui';
import { getNimiRuntimeReasonCodeMessage } from '@nimiplatform/sdk/runtime';
import type {
  NimiRuntimeLocalCatalogVariantDescriptor,
  NimiRuntimeLocalInstallPlanDescriptor,
  NimiRuntimeLocalRecommendationFeedItem,
} from '@nimiplatform/sdk/runtime';
import { Button, SectionTitle } from './runtime-config-primitives';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import {
  DownloadIcon,
  PackageIcon,
} from './runtime-config-local-model-center-icons';
import {
  recommendationTierLabel,
} from './runtime-config-local-model-center-helpers';
import { TOKEN_PANEL_CARD, tierPillClass } from './runtime-config-runtime-page-ui';
import { formatBytes } from './runtime-config-model-center-utils';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import {
  projectRecommendInstallPlanFailure,
  type RecommendInstallPlanFailure,
} from './runtime-config-page-recommend-utils';

type RecommendInstallSectionProps = {
  item: NimiRuntimeLocalRecommendationFeedItem;
  model: RuntimeConfigPanelControllerModel;
  controller: RecommendInstallController;
};

type RecommendInstallControllerInput = {
  item: NimiRuntimeLocalRecommendationFeedItem;
  model: RuntimeConfigPanelControllerModel;
};

type InstallPlanOptions = {
  entry?: string;
  files?: string[];
  hashes?: Record<string, string>;
};

export type RecommendInstallController = {
  planPreview: NimiRuntimeLocalInstallPlanDescriptor | null;
  planLoading: boolean;
  planError: RecommendInstallPlanFailure | null;
  variants: NimiRuntimeLocalCatalogVariantDescriptor[];
  variantsLoading: boolean;
  variantsRequested: boolean;
  variantsError: string;
  installing: boolean;
  reviewInstallPlan: (options?: InstallPlanOptions) => Promise<void>;
  openVariants: () => Promise<void>;
  installReviewedPlan: () => Promise<void>;
  openLocalModels: () => void;
};

function resolveInstallPlanPayload(
  item: NimiRuntimeLocalRecommendationFeedItem,
  options?: InstallPlanOptions,
) {
  return {
    source: item.source,
    modelId: item.installPayload.modelId,
    repo: item.installPayload.repo,
    revision: item.installPayload.revision,
    capabilities: item.installPayload.capabilities,
    engine: item.installPayload.engine,
    entry: options?.entry || item.installPayload.entry,
    files: options?.files || item.installPayload.files,
    license: item.installPayload.license,
    hashes: options?.hashes || item.installPayload.hashes,
    endpoint: item.installPayload.endpoint,
    engineConfig: item.installPayload.engineConfig,
  };
}

export function useRecommendInstallController({
  item,
  model,
}: RecommendInstallControllerInput): RecommendInstallController {
  const localEnvironmentClient = useRuntimeConfigLocalEnvironmentClient();
  const [planPreview, setPlanPreview] = useState<NimiRuntimeLocalInstallPlanDescriptor | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<RecommendInstallPlanFailure | null>(null);
  const [variants, setVariants] = useState<NimiRuntimeLocalCatalogVariantDescriptor[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsRequested, setVariantsRequested] = useState(false);
  const [variantsError, setVariantsError] = useState('');
  const [installing, setInstalling] = useState(false);

  const reviewInstallPlan = useCallback(async (
    options?: InstallPlanOptions,
  ) => {
    setPlanLoading(true);
    setPlanError(null);
    try {
      const plan = await localEnvironmentClient.resolveInstallPlan(resolveInstallPlanPayload(item, options));
      setPlanPreview(plan);
    } catch (err) {
      setPlanPreview(null);
      setPlanError(projectRecommendInstallPlanFailure(err));
    } finally {
      setPlanLoading(false);
    }
  }, [item]);

  const openVariants = useCallback(async () => {
    setVariantsLoading(true);
    setVariantsRequested(true);
    setVariantsError('');
    try {
      const rows = await localEnvironmentClient.listCatalogVariants(item.repo);
      setVariants([...rows]);
    } catch (err) {
      setVariants([]);
      setVariantsError(err instanceof Error ? err.message : String(err || 'Failed to load variants.'));
    } finally {
      setVariantsLoading(false);
    }
  }, [item.repo]);

  const installReviewedPlan = useCallback(async () => {
    if (!planPreview) return;
    setInstalling(true);
    try {
      await model.installResolvedModelPlan(planPreview);
    } finally {
      setInstalling(false);
    }
  }, [item, model, planPreview]);

  const openLocalModels = useCallback(() => {
    model.onChangePage('localModels');
  }, [model]);

  return {
    planPreview,
    planLoading,
    planError,
    variants,
    variantsLoading,
    variantsRequested,
    variantsError,
    installing,
    reviewInstallPlan,
    openVariants,
    installReviewedPlan,
    openLocalModels,
  };
}

export function RecommendInstallSection({
  item,
  model,
  controller,
}: RecommendInstallSectionProps) {
  const { t } = useTranslation();
  const {
    planPreview,
    planLoading,
    planError,
    variants,
    variantsLoading,
    variantsRequested,
    variantsError,
    installing,
    reviewInstallPlan,
    openVariants,
    installReviewedPlan,
    openLocalModels,
  } = controller;
  const installUnavailable = planError?.kind === 'template-unavailable';
  const reasonEntry = planError?.reasonCode
    ? getNimiRuntimeReasonCodeMessage(planError.reasonCode)
    : null;
  const planErrorMessage = !planError
    ? ''
    : installUnavailable
      ? t('runtimeConfig.recommend.installUnavailable', {
          defaultValue: 'This recommendation does not have a Runtime-installable version, so no download was started.',
        })
      : planError.kind === 'runtime-unavailable'
        ? t('runtimeConfig.recommend.installRuntimeUnavailable', {
            defaultValue: 'Runtime is unavailable. Check Runtime, then review the install again.',
          })
        : reasonEntry
          ? t(`BridgeErrors.codes.${reasonEntry.reasonCode}`, { defaultValue: reasonEntry.defaultMessage })
          : t('runtimeConfig.recommend.installReviewFailed', {
              defaultValue: 'The install plan could not be reviewed. Try again or choose another model.',
            });

  return (
    <div className="space-y-4">
      <SectionTitle>{t('runtimeConfig.recommend.detailInstallTitle', { defaultValue: 'Install' })}</SectionTitle>

      <div className="flex flex-wrap items-center gap-3">
        {item.installedState.installed ? (
          <Button variant="secondary" size="sm" onClick={openLocalModels}>
            {t('runtimeConfig.recommend.openLocalModels', { defaultValue: 'Open in Local Models' })}
          </Button>
        ) : installUnavailable ? (
          <Button size="sm" onClick={openLocalModels}>
            {t('runtimeConfig.recommend.browseInstallableModels', { defaultValue: 'Browse installable models' })}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={!item.actionState.canReviewInstallPlan || planLoading}
              onClick={() => void reviewInstallPlan()}
            >
              {planLoading
                ? t('runtimeConfig.recommend.reviewingPlan', { defaultValue: 'Reviewing\u2026' })
                : t('runtimeConfig.recommend.reviewInstallPlan', { defaultValue: 'Review Install Plan' })}
            </Button>
            {item.actionState.canOpenVariants ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={variantsLoading}
                onClick={() => void openVariants()}
              >
                {variantsLoading
                  ? t('runtimeConfig.recommend.loadingVariants', { defaultValue: 'Loading variants\u2026' })
                  : t('runtimeConfig.recommend.openVariants', { defaultValue: 'Open Variants' })}
              </Button>
            ) : null}
          </>
        )}
        {installing ? (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_16%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-action-primary-bg)]">
            {t('runtimeConfig.recommend.installing', { defaultValue: 'Installing\u2026' })}
          </span>
        ) : model.runtimeWritesDisabled ? (
          <span className="rounded-full bg-[var(--nimi-status-warning-soft-bg)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-status-warning-soft-text)]">
            {t('runtimeConfig.recommend.readOnly', { defaultValue: 'Read-only mode' })}
          </span>
        ) : null}
      </div>

      {(planPreview || planError) ? (
        <Surface tone="card" padding="none" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
          <div className="mb-3 flex items-center gap-2">
            <PackageIcon className="h-4 w-4 text-[var(--nimi-action-primary-bg)]" />
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.recommend.installPreviewTitle', { defaultValue: 'Install Review' })}
            </h4>
          </div>
          {planError ? (
            <div role="alert" className="rounded-lg border border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] px-4 py-3 text-sm text-[var(--nimi-status-danger-soft-text)]">
              <p>{planErrorMessage}</p>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  {t('runtimeConfig.recommend.technicalDetails', { defaultValue: 'Technical details' })}
                </summary>
                <div className="mt-2 space-y-1 font-mono break-all">
                  {planError.reasonCode ? <p>{planError.reasonCode}</p> : null}
                  {planError.technicalDetail && planError.technicalDetail !== planError.reasonCode
                    ? <p>{planError.technicalDetail}</p>
                    : null}
                </div>
              </details>
            </div>
          ) : null}
          {planPreview ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-[var(--nimi-surface-panel)] px-4 py-3">
                <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{planPreview.modelId}</p>
                <p className="mt-0.5 text-xs text-[var(--nimi-text-muted)]">{planPreview.repo}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--nimi-text-secondary)] sm:grid-cols-4">
                <div>
                  <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planEngine', { defaultValue: 'Engine' })}</span>
                  <p className="mt-0.5">{planPreview.engine}</p>
                </div>
                <div>
                  <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planEntry', { defaultValue: 'Entry' })}</span>
                  <p className="mt-0.5 font-mono">{planPreview.entry}</p>
                </div>
                <div>
                  <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planFiles', { defaultValue: 'Files' })}</span>
                  <p className="mt-0.5">{planPreview.files.length}</p>
                </div>
                {planPreview.engineRuntimeMode ? (
                  <div>
                    <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planRuntimeMode', { defaultValue: 'Runtime mode' })}</span>
                    <p className="mt-0.5">{planPreview.engineRuntimeMode}</p>
                  </div>
                ) : null}
              </div>
              {planPreview.warnings.length > 0 ? (
                <div className="rounded-lg border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] px-4 py-3 text-xs text-[var(--nimi-status-warning-soft-text)]">
                  <p className="font-medium">{t('runtimeConfig.recommend.planWarnings', { defaultValue: 'Warnings' })}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {planPreview.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </div>
              ) : null}
              <Button
                size="sm"
                disabled={model.runtimeWritesDisabled || installing}
                onClick={() => void installReviewedPlan()}
              >
                <span className="inline-flex items-center gap-1.5">
                  <DownloadIcon className="h-4 w-4" />
                  {installing
                    ? t('runtimeConfig.recommend.installing', { defaultValue: 'Installing\u2026' })
                    : t('runtimeConfig.recommend.startInstall', { defaultValue: 'Start Install' })}
                </span>
              </Button>
            </div>
          ) : null}
        </Surface>
      ) : null}

      {variantsError ? (
        <div className="rounded-lg border border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] px-3 py-2 text-xs text-[var(--nimi-status-danger-soft-text)]">{variantsError}</div>
      ) : null}
      {variantsRequested && !variantsLoading && !variantsError && variants.length === 0 ? (
        <div role="status" className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.recommend.variantsUnavailable', { defaultValue: 'No installable variants were returned for this model.' })}
        </div>
      ) : null}
      {variants.length > 0 ? (
        <Surface tone="card" padding="none" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
          <h4 className="mb-3 text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.recommend.variantsTitle', { defaultValue: 'Variants' })}
          </h4>
          <div className="space-y-2">
            {variants.map((variant) => (
              <div key={variant.entry || variant.filename} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-[var(--nimi-text-secondary)]">{variant.entry || variant.filename}</p>
                  <p className="mt-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                    {[variant.format || 'unknown', variant.sizeBytes ? formatBytes(variant.sizeBytes) : ''].filter(Boolean).join(' \u00b7 ')}
                  </p>
                </div>
                {variant.recommendation?.tier ? (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium ${tierPillClass(variant.recommendation.tier)}`}>
                    {recommendationTierLabel(variant.recommendation.tier)}
                  </span>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void reviewInstallPlan({
                    entry: variant.entry || variant.filename,
                    files: [...variant.files],
                    hashes: variant.sha256 ? { [variant.entry || variant.filename]: variant.sha256 } : undefined,
                  })}
                >
                  {t('runtimeConfig.recommend.reviewVariantPlan', { defaultValue: 'Review this variant' })}
                </Button>
              </div>
            ))}
          </div>
        </Surface>
      ) : null}
    </div>
  );
}
