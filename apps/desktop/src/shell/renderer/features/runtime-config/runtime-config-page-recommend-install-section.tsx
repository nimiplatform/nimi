import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  localRuntime,
  type LocalRuntimeCatalogVariantDescriptor,
  type LocalRuntimeInstallPayload,
  type LocalRuntimeInstallPlanDescriptor,
  type LocalRuntimeRecommendationFeedItemDescriptor,
} from '@nimiplatform/sdk/runtime';
import { Button, Card } from './runtime-config-primitives';
import {
  DownloadIcon,
  PackageIcon,
} from './runtime-config-local-model-center-icons';
import {
  recommendationTierClass,
  recommendationTierLabel,
} from './runtime-config-local-model-center-helpers';
import { formatBytes } from './runtime-config-model-center-utils';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';

type RecommendInstallSectionProps = {
  item: LocalRuntimeRecommendationFeedItemDescriptor;
  model: RuntimeConfigPanelControllerModel;
  controller: RecommendInstallController;
};

type RecommendInstallControllerInput = {
  item: LocalRuntimeRecommendationFeedItemDescriptor;
  model: RuntimeConfigPanelControllerModel;
};

type InstallPlanOptions = {
  entry?: string;
  files?: string[];
  hashes?: Record<string, string>;
};

export type RecommendInstallController = {
  planPreview: LocalRuntimeInstallPlanDescriptor | null;
  planLoading: boolean;
  planError: string;
  variants: LocalRuntimeCatalogVariantDescriptor[];
  variantsLoading: boolean;
  variantsError: string;
  installing: boolean;
  reviewInstallPlan: (options?: InstallPlanOptions) => Promise<void>;
  openVariants: () => Promise<void>;
  installReviewedPlan: () => Promise<void>;
  openLocalModels: () => void;
};

function installPayloadFromPlan(
  plan: LocalRuntimeInstallPlanDescriptor,
  item: LocalRuntimeRecommendationFeedItemDescriptor,
): LocalRuntimeInstallPayload {
  return {
    modelId: plan.modelId,
    kind: item.installPayload.kind,
    repo: plan.repo,
    revision: plan.revision,
    capabilities: plan.capabilities,
    engine: plan.engine,
    entry: plan.entry,
    files: plan.files,
    license: plan.license,
    hashes: plan.hashes,
    endpoint: plan.endpoint,
    engineConfig: plan.engineConfig,
  };
}

function resolveInstallPlanPayload(
  item: LocalRuntimeRecommendationFeedItemDescriptor,
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
  const [planPreview, setPlanPreview] = useState<LocalRuntimeInstallPlanDescriptor | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [variants, setVariants] = useState<LocalRuntimeCatalogVariantDescriptor[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState('');
  const [installing, setInstalling] = useState(false);

  const reviewInstallPlan = useCallback(async (
    options?: InstallPlanOptions,
  ) => {
    setPlanLoading(true);
    setPlanError('');
    try {
      const plan = await localRuntime.resolveInstallPlan(resolveInstallPlanPayload(item, options));
      setPlanPreview(plan);
    } catch (err) {
      setPlanPreview(null);
      setPlanError(err instanceof Error ? err.message : String(err || 'Failed to resolve install plan.'));
    } finally {
      setPlanLoading(false);
    }
  }, [item]);

  const openVariants = useCallback(async () => {
    setVariantsLoading(true);
    setVariantsError('');
    try {
      const rows = await localRuntime.listRepoVariants(item.repo);
      setVariants(rows);
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
      await model.installLocalModel(installPayloadFromPlan(planPreview, item));
    } finally {
      setInstalling(false);
    }
  }, [item, model, planPreview]);

  const openLocalModels = useCallback(() => {
    model.setLocalModelQuery(item.title || item.installPayload.modelId);
    model.onChangePage('models');
  }, [model, item]);

  return {
    planPreview,
    planLoading,
    planError,
    variants,
    variantsLoading,
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
    variantsError,
    installing,
    reviewInstallPlan,
    openVariants,
    installReviewedPlan,
    openLocalModels,
  } = controller;

  return (
    <div className="space-y-4">
      <SectionHeading>{t('runtimeConfig.recommend.detailInstallTitle', { defaultValue: 'Install' })}</SectionHeading>

      <div className="flex flex-wrap items-center gap-3">
        {item.installedState.installed ? (
          <Button variant="secondary" size="sm" onClick={openLocalModels}>
            {t('runtimeConfig.recommend.openLocalModels', { defaultValue: 'Open in Local Models' })}
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
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-status-warning)]">
            {t('runtimeConfig.recommend.readOnly', { defaultValue: 'Read-only mode' })}
          </span>
        ) : null}
      </div>

      {(planPreview || planError) ? (
        <Card className="rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-white p-5 shadow-none">
          <div className="mb-3 flex items-center gap-2">
            <PackageIcon className="h-4 w-4 text-[var(--nimi-action-primary-bg)]" />
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.recommend.installPreviewTitle', { defaultValue: 'Install Review' })}
            </h4>
          </div>
          {planError ? (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">{planError}</div>
          ) : null}
          {planPreview ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-3">
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
                <div>
                  <span className="font-medium text-[var(--nimi-text-primary)]">{t('runtimeConfig.recommend.planRuntimeMode', { defaultValue: 'Runtime mode' })}</span>
                  <p className="mt-0.5">{planPreview.engineRuntimeMode}</p>
                </div>
              </div>
              {planPreview.warnings.length > 0 ? (
                <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] px-4 py-3 text-xs text-[var(--nimi-status-warning)]">
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
        </Card>
      ) : null}

      {variantsError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">{variantsError}</div>
      ) : null}
      {variants.length > 0 ? (
        <Card className="rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-white p-5 shadow-none">
          <h4 className="mb-3 text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.recommend.variantsTitle', { defaultValue: 'Variants' })}
          </h4>
          <div className="space-y-2">
            {variants.map((variant) => (
              <div key={variant.entry || variant.filename} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-[var(--nimi-text-secondary)]">{variant.entry || variant.filename}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--nimi-text-muted)]">
                    {[variant.format || 'unknown', variant.sizeBytes ? formatBytes(variant.sizeBytes) : ''].filter(Boolean).join(' \u00b7 ')}
                  </p>
                </div>
                {variant.recommendation?.tier ? (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${recommendationTierClass(variant.recommendation.tier)}`}>
                    {recommendationTierLabel(variant.recommendation.tier)}
                  </span>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void reviewInstallPlan({
                    entry: variant.entry || variant.filename,
                    files: variant.files,
                    hashes: variant.sha256 ? { [variant.entry || variant.filename]: variant.sha256 } : undefined,
                  })}
                >
                  {t('runtimeConfig.recommend.reviewVariantPlan', { defaultValue: 'Review this variant' })}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-bold text-[var(--nimi-text-primary)]">{children}</h3>;
}
