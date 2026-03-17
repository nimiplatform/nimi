import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeLocaleTime } from '@renderer/i18n';
import {
  localRuntime,
  type LocalRuntimeCatalogVariantDescriptor,
  type LocalRuntimeInstallPayload,
  type LocalRuntimeInstallPlanDescriptor,
  type LocalRuntimeRecommendationFeedItemDescriptor,
} from '@runtime/local-runtime';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Card, Button, RuntimeSelect } from './runtime-config-primitives';
import { formatBytes } from './runtime-config-model-center-utils';
import {
  DownloadIcon,
  HeartPulseIcon,
  PackageIcon,
  RefreshIcon,
  recommendationBaselineLabel,
  recommendationSummary,
  recommendationTierClass,
  recommendationTierLabel,
  SearchIcon,
  StarIcon,
} from './runtime-config-local-model-center-helpers';
import {
  RecommendationSection,
} from './runtime-config-page-recommend-sections';
import {
  RECOMMEND_PAGE_CAPABILITIES,
  filterRecommendationFeedItems,
  normalizeRecommendPageCapability,
  recommendationFeedCacheSummary,
  splitRecommendationFeedItems,
  type RecommendPageCapability,
} from './runtime-config-page-recommend-utils';

type RecommendPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

function formatFeedTimestamp(value?: string): string {
  if (!value) {
    return '-';
  }
  return formatRelativeLocaleTime(value);
}

function cacheStateLabel(cacheState: 'fresh' | 'stale' | 'empty', t: RecommendPageProps extends never ? never : ReturnType<typeof useTranslation>['t']): string {
  if (cacheState === 'fresh') {
    return t('runtimeConfig.recommend.cacheFresh', { defaultValue: 'Fresh feed' });
  }
  if (cacheState === 'stale') {
    return t('runtimeConfig.recommend.cacheStale', { defaultValue: 'Showing cached results' });
  }
  return t('runtimeConfig.recommend.cacheEmpty', { defaultValue: 'No cached results' });
}

function cacheStateClass(cacheState: 'fresh' | 'stale' | 'empty'): string {
  if (cacheState === 'fresh') {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (cacheState === 'stale') {
    return 'bg-amber-100 text-amber-700';
  }
  return 'bg-slate-100 text-slate-600';
}

function formatGpuSummary(totalVramBytes?: number, availableVramBytes?: number, memoryModel?: string): string {
  if (memoryModel === 'unified') {
    return availableVramBytes && availableVramBytes > 0
      ? `Unified · ${formatBytes(availableVramBytes)} available`
      : 'Unified';
  }
  if (totalVramBytes && totalVramBytes > 0) {
    const available = availableVramBytes && availableVramBytes > 0
      ? ` · ${formatBytes(availableVramBytes)} free`
      : '';
    return `${formatBytes(totalVramBytes)} VRAM${available}`;
  }
  return 'Unknown memory';
}

function installPayloadFromPlan(plan: LocalRuntimeInstallPlanDescriptor): LocalRuntimeInstallPayload {
  return {
    modelId: plan.modelId,
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
  options?: {
    entry?: string;
    files?: string[];
    hashes?: Record<string, string>;
  },
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

export function RecommendPage({ model, state }: RecommendPageProps) {
  const { t } = useTranslation();
  const capability = normalizeRecommendPageCapability(state.activeCapability);
  const [feed, setFeed] = useState<Awaited<ReturnType<typeof localRuntime.getRecommendationFeed>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [planPreview, setPlanPreview] = useState<LocalRuntimeInstallPlanDescriptor | null>(null);
  const [planPreviewItemId, setPlanPreviewItemId] = useState('');
  const [planLoadingItemId, setPlanLoadingItemId] = useState('');
  const [planError, setPlanError] = useState('');
  const [variants, setVariants] = useState<LocalRuntimeCatalogVariantDescriptor[]>([]);
  const [variantItemId, setVariantItemId] = useState('');
  const [variantsLoadingItemId, setVariantsLoadingItemId] = useState('');
  const [variantsError, setVariantsError] = useState('');
  const [installingItemId, setInstallingItemId] = useState('');

  const refreshFeed = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextFeed = await localRuntime.getRecommendationFeed({
        capability,
        pageSize: 48,
      });
      setFeed(nextFeed);
    } catch (nextError) {
      setFeed(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError || 'Failed to load recommendation feed.'));
    } finally {
      setLoading(false);
    }
  }, [capability]);

  useEffect(() => {
    void refreshFeed();
  }, [refreshFeed]);

  const filteredItems = useMemo(
    () => filterRecommendationFeedItems(feed?.items || [], deferredSearchQuery),
    [deferredSearchQuery, feed?.items],
  );
  const sections = useMemo(
    () => splitRecommendationFeedItems(filteredItems),
    [filteredItems],
  );
  const cacheState = recommendationFeedCacheSummary(feed);
  const activePlanItem = useMemo(
    () => (feed?.items || []).find((item) => item.itemId === planPreviewItemId) || null,
    [feed?.items, planPreviewItemId],
  );
  const activeVariantItem = useMemo(
    () => (feed?.items || []).find((item) => item.itemId === variantItemId) || null,
    [feed?.items, variantItemId],
  );

  const setActiveCapability = useCallback((next: RecommendPageCapability) => {
    model.updateState((prev) => ({
      ...prev,
      activeCapability: next,
    }));
  }, [model]);

  const reviewInstallPlan = useCallback(async (
    item: LocalRuntimeRecommendationFeedItemDescriptor,
    options?: {
      entry?: string;
      files?: string[];
      hashes?: Record<string, string>;
    },
  ) => {
    setPlanLoadingItemId(item.itemId);
    setPlanPreviewItemId(item.itemId);
    setPlanError('');
    try {
      const plan = await localRuntime.resolveInstallPlan(resolveInstallPlanPayload(item, options));
      setPlanPreview(plan);
    } catch (nextError) {
      setPlanPreview(null);
      setPlanError(nextError instanceof Error ? nextError.message : String(nextError || 'Failed to resolve install plan.'));
    } finally {
      setPlanLoadingItemId('');
    }
  }, []);

  const openVariants = useCallback(async (item: LocalRuntimeRecommendationFeedItemDescriptor) => {
    setVariantsLoadingItemId(item.itemId);
    setVariantItemId(item.itemId);
    setVariantsError('');
    try {
      const rows = await localRuntime.listRepoVariants(item.repo);
      setVariants(rows);
    } catch (nextError) {
      setVariants([]);
      setVariantsError(nextError instanceof Error ? nextError.message : String(nextError || 'Failed to load variants.'));
    } finally {
      setVariantsLoadingItemId('');
    }
  }, []);

  const installReviewedPlan = useCallback(async () => {
    if (!planPreview) {
      return;
    }
    setInstallingItemId(planPreviewItemId);
    try {
      await model.installLocalModel(installPayloadFromPlan(planPreview));
    } finally {
      setInstallingItemId('');
    }
  }, [model, planPreview, planPreviewItemId]);

  const openLocalModels = useCallback((item: LocalRuntimeRecommendationFeedItemDescriptor) => {
    model.setLocalModelQuery(item.title || item.installPayload.modelId);
    model.onChangePage('local');
  }, [model]);

  const gpu = feed?.deviceProfile.gpu;
  const machineCards = [
    {
      key: 'os',
      label: t('runtimeConfig.recommend.machineOs', { defaultValue: 'OS / Arch' }),
      value: feed ? `${feed.deviceProfile.os} · ${feed.deviceProfile.arch}` : '-',
    },
    {
      key: 'ram',
      label: t('runtimeConfig.recommend.machineRam', { defaultValue: 'System RAM' }),
      value: feed
        ? `${formatBytes(feed.deviceProfile.availableRamBytes)} / ${formatBytes(feed.deviceProfile.totalRamBytes)}`
        : '-',
    },
    {
      key: 'gpu',
      label: t('runtimeConfig.recommend.machineGpu', { defaultValue: 'GPU' }),
      value: feed
        ? [
            [feed.deviceProfile.gpu.vendor, feed.deviceProfile.gpu.model].filter(Boolean).join(' '),
            formatGpuSummary(gpu?.totalVramBytes, gpu?.availableVramBytes, gpu?.memoryModel),
          ].filter(Boolean).join(' · ') || t('runtimeConfig.recommend.machineGpuUnknown', { defaultValue: 'GPU unavailable' })
        : '-',
    },
    {
      key: 'capability',
      label: t('runtimeConfig.recommend.machineCapability', { defaultValue: 'Capability' }),
      value: capability,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <Card className="overflow-hidden rounded-[28px] border border-mint-200/70 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_42%),linear-gradient(135deg,#f7fffb_0%,#f8fafc_65%,#eef7ff_100%)] p-6 shadow-[0_28px_70px_rgba(15,23,42,0.10)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-mint-700">
              {t('runtimeConfig.recommend.heroEyebrow', { defaultValue: 'Local Recommendation Feed' })}
            </p>
            <h3 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              {t('runtimeConfig.recommend.heroTitle', { defaultValue: 'Best local models for this machine' })}
            </h3>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              {t('runtimeConfig.recommend.heroBody', {
                defaultValue: 'This page ranks chat, image, and video candidates with the current device profile, then keeps install and variant review on the same local runtime contracts.',
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-[11px] font-medium ${cacheStateClass(cacheState)}`}>
              {cacheStateLabel(cacheState, t)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void refreshFeed()}>
              <span className="inline-flex items-center gap-1.5">
                <RefreshIcon className="h-4 w-4" />
                {loading
                  ? t('runtimeConfig.recommend.refreshing', { defaultValue: 'Refreshing…' })
                  : t('runtimeConfig.recommend.refresh', { defaultValue: 'Refresh feed' })}
              </span>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {machineCards.map((item) => (
            <div key={item.key} className="rounded-[22px] border border-white/70 bg-white/85 px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <HeartPulseIcon className="h-4 w-4 text-mint-600" />
          <span>
            {t('runtimeConfig.recommend.generatedAt', {
              when: formatFeedTimestamp(feed?.generatedAt),
              defaultValue: 'Updated {{when}}',
            })}
          </span>
        </div>
      </Card>

      <Card className="rounded-[24px] border border-slate-200/70 bg-white/95 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-mint-600">
              {t('runtimeConfig.recommend.controlsEyebrow', { defaultValue: 'Search More' })}
            </p>
            <div className="mt-2 flex flex-col gap-3 md:flex-row">
              <div className="min-w-0 flex-1">
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  {t('runtimeConfig.recommend.searchLabel', { defaultValue: 'Filter current feed' })}
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <SearchIcon className="h-4 w-4" />
                  </div>
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('runtimeConfig.recommend.searchPlaceholder', { defaultValue: 'Search title, repo, tag, or entry…' })}
                    className="h-11 w-full rounded-xl border border-mint-100 bg-[#F4FBF8] pl-10 pr-4 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
                  />
                </div>
              </div>
              <div className="w-full md:w-56">
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  {t('runtimeConfig.recommend.capabilityLabel', { defaultValue: 'Capability' })}
                </label>
                <RuntimeSelect
                  value={capability}
                  onChange={(value) => setActiveCapability(normalizeRecommendPageCapability(value))}
                  options={RECOMMEND_PAGE_CAPABILITIES.map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {cacheState === 'stale' ? (
        <Card className="rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t('runtimeConfig.recommend.staleNotice', {
            defaultValue: 'The recommendation feed is currently showing the last successful snapshot. Refresh when the model-index worker is reachable again.',
          })}
        </Card>
      ) : null}

      {loading ? (
        <Card className="rounded-[24px] border border-slate-200 bg-white/95 p-8 text-sm text-slate-500 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          {t('runtimeConfig.recommend.loadingFeed', { defaultValue: 'Loading recommendation feed…' })}
        </Card>
      ) : error && !feed ? (
        <Card className="rounded-[24px] border border-rose-200 bg-rose-50 p-8 text-sm text-rose-900 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          <p className="font-medium">{t('runtimeConfig.recommend.loadFailed', { defaultValue: 'Failed to load recommendation feed.' })}</p>
          <p className="mt-2 text-xs opacity-80">{error}</p>
        </Card>
      ) : feed && filteredItems.length === 0 ? (
        <Card className="rounded-[24px] border border-dashed border-slate-200 bg-white/95 p-8 text-sm text-slate-500 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
          {cacheState === 'empty'
            ? t('runtimeConfig.recommend.offlineEmpty', {
                defaultValue: 'No recommendation snapshot is available yet. Connect the model-index worker, then refresh this page.',
              })
            : t('runtimeConfig.recommend.noMatches', {
                defaultValue: 'Nothing matched the current filters. Try another search term or capability.',
              })}
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <RecommendationSection
              title={t('runtimeConfig.recommend.topMatchesTitle', { defaultValue: 'Top Matches' })}
              eyebrow={t('runtimeConfig.recommend.topMatchesEyebrow', { defaultValue: 'Recommended now' })}
              emptyMessage={t('runtimeConfig.recommend.topMatchesEmpty', { defaultValue: 'No recommended or runnable matches yet for this capability.' })}
              items={sections.topMatches}
              runtimeWritesDisabled={model.runtimeWritesDisabled}
              loadingPlanItemId={planLoadingItemId}
              loadingVariantsItemId={variantsLoadingItemId}
              installingItemId={installingItemId}
              onReviewPlan={(item) => void reviewInstallPlan(item)}
              onOpenVariants={(item) => void openVariants(item)}
              onOpenLocalModels={openLocalModels}
            />
            <RecommendationSection
              title={t('runtimeConfig.recommend.worthTryingTitle', { defaultValue: 'Worth Trying' })}
              eyebrow={t('runtimeConfig.recommend.worthTryingEyebrow', { defaultValue: 'Tight fit' })}
              emptyMessage={t('runtimeConfig.recommend.worthTryingEmpty', { defaultValue: 'No tight-fit candidates are currently in this feed.' })}
              items={sections.worthTrying}
              runtimeWritesDisabled={model.runtimeWritesDisabled}
              loadingPlanItemId={planLoadingItemId}
              loadingVariantsItemId={variantsLoadingItemId}
              installingItemId={installingItemId}
              onReviewPlan={(item) => void reviewInstallPlan(item)}
              onOpenVariants={(item) => void openVariants(item)}
              onOpenLocalModels={openLocalModels}
            />
            <RecommendationSection
              title={t('runtimeConfig.recommend.installedTitle', { defaultValue: 'Already Installed' })}
              eyebrow={t('runtimeConfig.recommend.installedEyebrow', { defaultValue: 'Ready in local runtime' })}
              emptyMessage={t('runtimeConfig.recommend.installedEmpty', { defaultValue: 'No installed models in this capability are currently tracked by the recommendation feed.' })}
              items={sections.alreadyInstalled}
              runtimeWritesDisabled={model.runtimeWritesDisabled}
              loadingPlanItemId={planLoadingItemId}
              loadingVariantsItemId={variantsLoadingItemId}
              installingItemId={installingItemId}
              onReviewPlan={(item) => void reviewInstallPlan(item)}
              onOpenVariants={(item) => void openVariants(item)}
              onOpenLocalModels={openLocalModels}
            />
            <RecommendationSection
              title={t('runtimeConfig.recommend.searchMoreTitle', { defaultValue: 'Search More' })}
              eyebrow={t('runtimeConfig.recommend.searchMoreEyebrow', { defaultValue: 'Everything else in this feed' })}
              emptyMessage={t('runtimeConfig.recommend.searchMoreEmpty', { defaultValue: 'No additional candidates remain after the current filters.' })}
              items={sections.searchMore}
              runtimeWritesDisabled={model.runtimeWritesDisabled}
              loadingPlanItemId={planLoadingItemId}
              loadingVariantsItemId={variantsLoadingItemId}
              installingItemId={installingItemId}
              onReviewPlan={(item) => void reviewInstallPlan(item)}
              onOpenVariants={(item) => void openVariants(item)}
              onOpenLocalModels={openLocalModels}
            />
          </div>

          <div className="space-y-6">
            <Card className="rounded-[24px] border border-slate-200/70 bg-white/95 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
              <div className="flex items-center gap-2">
                <StarIcon className="h-4 w-4 text-mint-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  {t('runtimeConfig.recommend.whyRankingTitle', { defaultValue: 'Why This Ranking' })}
                </h3>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="rounded-2xl bg-slate-50 px-3 py-3">
                  <p className="font-medium text-slate-800">{t('runtimeConfig.recommend.whyRankingTierTitle', { defaultValue: '1. Fit tier first' })}</p>
                  <p className="mt-1 leading-6">
                    {t('runtimeConfig.recommend.whyRankingTierBody', {
                      defaultValue: 'Items are grouped by recommended, runnable, tight, then everything else. The tier always means main-model fit, not full workflow readiness.',
                    })}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-3 py-3">
                  <p className="font-medium text-slate-800">{t('runtimeConfig.recommend.whyRankingHostTitle', { defaultValue: '2. Host support stays visible' })}</p>
                  <p className="mt-1 leading-6">
                    {t('runtimeConfig.recommend.whyRankingHostBody', {
                      defaultValue: 'Managed support, attached-only support, and unsupported hosts are shown beside the fit tier so a memory fit never hides runtime constraints.',
                    })}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-3 py-3">
                  <p className="font-medium text-slate-800">{t('runtimeConfig.recommend.whyRankingConfidenceTitle', { defaultValue: '3. Confidence explains missing metadata' })}</p>
                  <p className="mt-1 leading-6">
                    {t('runtimeConfig.recommend.whyRankingConfidenceBody', {
                      defaultValue: 'SafeTensors repos and heuristic llmfit candidates can still show up, but lower confidence keeps incomplete metadata from looking definitive.',
                    })}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="rounded-[24px] border border-slate-200/70 bg-white/95 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
              <div className="flex items-center gap-2">
                <PackageIcon className="h-4 w-4 text-mint-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  {t('runtimeConfig.recommend.installPreviewTitle', { defaultValue: 'Install Review' })}
                </h3>
              </div>
              {!planPreview && !planError ? (
                <p className="mt-4 text-sm leading-6 text-slate-500">
                  {t('runtimeConfig.recommend.installPreviewEmpty', { defaultValue: 'Review an item to inspect the exact entry, files, engine, and warnings before starting an install.' })}
                </p>
              ) : null}
              {planError ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
                  {planError}
                </div>
              ) : null}
              {planPreview ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl bg-slate-50 px-3 py-3">
                    <p className="text-sm font-semibold text-slate-900">{planPreview.modelId}</p>
                    <p className="mt-1 text-xs text-slate-500">{planPreview.repo}</p>
                  </div>
                  <div className="space-y-2 text-xs text-slate-600">
                    <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planEngine', { defaultValue: 'Engine' })}:</span> {planPreview.engine}</p>
                    <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planEntry', { defaultValue: 'Entry' })}:</span> <span className="font-mono">{planPreview.entry}</span></p>
                    <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planFiles', { defaultValue: 'Files' })}:</span> {planPreview.files.length}</p>
                    <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planRuntimeMode', { defaultValue: 'Runtime mode' })}:</span> {planPreview.engineRuntimeMode}</p>
                    {activePlanItem?.recommendation?.baseline ? (
                      <p><span className="font-medium text-slate-800">{t('runtimeConfig.recommend.planBaseline', { defaultValue: 'Baseline' })}:</span> {recommendationBaselineLabel(activePlanItem.recommendation.baseline)}</p>
                    ) : null}
                  </div>
                  {planPreview.warnings.length > 0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                      <p className="font-medium">{t('runtimeConfig.recommend.planWarnings', { defaultValue: 'Warnings' })}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {planPreview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={model.runtimeWritesDisabled || installingItemId === planPreviewItemId}
                      onClick={() => void installReviewedPlan()}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <DownloadIcon className="h-4 w-4" />
                        {installingItemId === planPreviewItemId
                          ? t('runtimeConfig.recommend.installing', { defaultValue: 'Installing…' })
                          : t('runtimeConfig.recommend.startInstall', { defaultValue: 'Start Install' })}
                      </span>
                    </Button>
                    {activePlanItem ? (
                      <Button variant="secondary" size="sm" onClick={() => openLocalModels(activePlanItem)}>
                        {t('runtimeConfig.recommend.openLocalModels', { defaultValue: 'Open in Local Models' })}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Card>

            <Card className="rounded-[24px] border border-slate-200/70 bg-white/95 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
              <div className="flex items-center gap-2">
                <PackageIcon className="h-4 w-4 text-mint-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  {t('runtimeConfig.recommend.variantsTitle', { defaultValue: 'Variants' })}
                </h3>
              </div>
              {!activeVariantItem && !variantsError ? (
                <p className="mt-4 text-sm leading-6 text-slate-500">
                  {t('runtimeConfig.recommend.variantsEmpty', { defaultValue: 'Open variants on a model card to compare alternative entries before reviewing the plan.' })}
                </p>
              ) : null}
              {variantsError ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
                  {variantsError}
                </div>
              ) : null}
              {activeVariantItem ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm font-medium text-slate-900">{activeVariantItem.title}</p>
                  {variants.length === 0 && !variantsLoadingItemId ? (
                    <p className="text-xs text-slate-500">
                      {t('runtimeConfig.recommend.variantsUnavailable', { defaultValue: 'No variant metadata was returned for this repo.' })}
                    </p>
                  ) : null}
                  {variants.map((variant) => (
                    <div key={`${variant.entry || variant.filename}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[11px] text-slate-700">{variant.entry || variant.filename}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {[variant.format || 'unknown', formatBytes(variant.sizeBytes)].filter((value) => value && value !== '0 B').join(' · ')}
                          </p>
                          {variant.recommendation ? (
                            <p className="mt-2 text-[11px] leading-5 text-slate-600">{recommendationSummary(variant.recommendation)}</p>
                          ) : null}
                        </div>
                        {variant.recommendation ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${recommendationTierClass(variant.recommendation.tier)}`}>
                            {recommendationTierLabel(variant.recommendation.tier)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void reviewInstallPlan(activeVariantItem, {
                            entry: variant.entry || variant.filename,
                            files: variant.files,
                            hashes: variant.sha256
                              ? { [variant.entry || variant.filename]: variant.sha256 }
                              : undefined,
                          })}
                        >
                          {t('runtimeConfig.recommend.reviewVariantPlan', { defaultValue: 'Review this variant' })}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
