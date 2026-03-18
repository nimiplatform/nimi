import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  localRuntime,
  type LocalRuntimeCatalogVariantDescriptor,
  type LocalRuntimeInstallPayload,
  type LocalRuntimeInstallPlanDescriptor,
  type LocalRuntimeRecommendationFeedItemDescriptor,
} from '@runtime/local-runtime';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Card, RuntimeSelect } from './runtime-config-primitives';
import { SearchIcon } from './runtime-config-local-model-center-icons';
import {
  RECOMMEND_PAGE_CAPABILITIES,
  RECOMMEND_SORT_OPTIONS,
  applyFilters,
  collectUniqueLicenses,
  collectUniqueProviders,
  computeTierCounts,
  emptyFilters,
  normalizeRecommendPageCapability,
  recommendationFeedCacheSummary,
  sortFeedItems,
  type RecommendFilters,
  type RecommendGrade,
  type RecommendPageCapability,
  type RecommendSortKey,
} from './runtime-config-page-recommend-utils';
import {
  DeviceProfileBar,
  FilterChip,
  ModelRow,
  ModelRowExpanded,
  TierSummaryBar,
} from './runtime-config-page-recommend-sections';

type RecommendPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

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

  // ---------------------------------------------------------------------------
  // Feed state
  // ---------------------------------------------------------------------------
  const [feed, setFeed] = useState<Awaited<ReturnType<typeof localRuntime.getRecommendationFeed>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ---------------------------------------------------------------------------
  // Filter / sort state
  // ---------------------------------------------------------------------------
  const [filters, setFilters] = useState<RecommendFilters>(emptyFilters);
  const deferredQuery = useDeferredValue(filters.query);
  const [sortKey, setSortKey] = useState<RecommendSortKey>('score');

  // ---------------------------------------------------------------------------
  // Expanded row state
  // ---------------------------------------------------------------------------
  const [expandedItemId, setExpandedItemId] = useState('');

  // ---------------------------------------------------------------------------
  // Plan / variants / install state (per expanded item)
  // ---------------------------------------------------------------------------
  const [planPreview, setPlanPreview] = useState<LocalRuntimeInstallPlanDescriptor | null>(null);
  const [planPreviewItemId, setPlanPreviewItemId] = useState('');
  const [planLoadingItemId, setPlanLoadingItemId] = useState('');
  const [planError, setPlanError] = useState('');
  const [variants, setVariants] = useState<LocalRuntimeCatalogVariantDescriptor[]>([]);
  const [variantItemId, setVariantItemId] = useState('');
  const [variantsLoadingItemId, setVariantsLoadingItemId] = useState('');
  const [variantsError, setVariantsError] = useState('');
  const [installingItemId, setInstallingItemId] = useState('');

  // ---------------------------------------------------------------------------
  // Feed refresh
  // ---------------------------------------------------------------------------
  const refreshFeed = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextFeed = await localRuntime.getRecommendationFeed({ capability, pageSize: 48 });
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

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const allItems = feed?.items || [];
  const effectiveFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [filters, deferredQuery]);
  const filteredItems = useMemo(() => applyFilters(allItems, effectiveFilters), [allItems, effectiveFilters]);
  const sortedItems = useMemo(() => sortFeedItems(filteredItems, sortKey), [filteredItems, sortKey]);
  const tierCounts = useMemo(() => computeTierCounts(allItems), [allItems]);
  const uniqueProviders = useMemo(() => collectUniqueProviders(allItems), [allItems]);
  const uniqueLicenses = useMemo(() => collectUniqueLicenses(allItems), [allItems]);
  const cacheState = recommendationFeedCacheSummary(feed);
  const totalVramBytes = feed?.deviceProfile.gpu.totalVramBytes;

  // ---------------------------------------------------------------------------
  // Filter helpers
  // ---------------------------------------------------------------------------
  const setQuery = useCallback((query: string) => setFilters((prev) => ({ ...prev, query })), []);

  const toggleGrade = useCallback((grade: string) => {
    setFilters((prev) => {
      const next = new Set(prev.grades);
      if (next.has(grade as RecommendGrade)) {
        next.delete(grade as RecommendGrade);
      } else {
        next.add(grade as RecommendGrade);
      }
      return { ...prev, grades: next };
    });
  }, []);

  const toggleProvider = useCallback((provider: string) => {
    setFilters((prev) => {
      const next = new Set(prev.providers);
      if (next.has(provider)) next.delete(provider); else next.add(provider);
      return { ...prev, providers: next };
    });
  }, []);

  const toggleLicense = useCallback((license: string) => {
    setFilters((prev) => {
      const next = new Set(prev.licenses);
      if (next.has(license)) next.delete(license); else next.add(license);
      return { ...prev, licenses: next };
    });
  }, []);

  const setActiveCapability = useCallback((next: RecommendPageCapability) => {
    model.updateState((prev) => ({ ...prev, activeCapability: next }));
  }, [model]);

  // ---------------------------------------------------------------------------
  // Expand / collapse
  // ---------------------------------------------------------------------------
  const toggleExpand = useCallback((itemId: string) => {
    setExpandedItemId((prev) => (prev === itemId ? '' : itemId));
  }, []);

  // ---------------------------------------------------------------------------
  // Plan / variants / install actions
  // ---------------------------------------------------------------------------
  const reviewInstallPlan = useCallback(async (
    item: LocalRuntimeRecommendationFeedItemDescriptor,
    options?: { entry?: string; files?: string[]; hashes?: Record<string, string> },
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
    if (!planPreview) return;
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      {/* Hero: Device Profile Bar */}
      {feed ? (
        <DeviceProfileBar
          os={feed.deviceProfile.os}
          arch={feed.deviceProfile.arch}
          totalRamBytes={feed.deviceProfile.totalRamBytes}
          gpu={feed.deviceProfile.gpu}
          cacheState={cacheState}
          generatedAt={feed.generatedAt}
          loading={loading}
          onRefresh={() => void refreshFeed()}
        />
      ) : !loading ? null : (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/95 px-5 py-3 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-mint-500 border-t-transparent" />
          <span className="text-sm text-slate-500">{t('runtimeConfig.recommend.loadingFeed', { defaultValue: 'Detecting hardware…' })}</span>
        </div>
      )}

      {/* Tier Summary Bar */}
      {allItems.length > 0 ? (
        <TierSummaryBar counts={tierCounts} activeGrades={filters.grades} onToggleGrade={toggleGrade} />
      ) : null}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <SearchIcon className="h-4 w-4" />
          </div>
          <input
            value={filters.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('runtimeConfig.recommend.searchPlaceholder', { defaultValue: 'Search models…' })}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-mint-400 focus:ring-2 focus:ring-mint-100"
          />
        </div>

        {/* Capability (Task) */}
        <RuntimeSelect
          value={capability}
          onChange={(value) => setActiveCapability(normalizeRecommendPageCapability(value))}
          options={RECOMMEND_PAGE_CAPABILITIES.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))}
          size="sm"
          className="w-24"
        />

        {/* Provider filter */}
        {uniqueProviders.length > 0 ? (
          <FilterChip
            label={t('runtimeConfig.recommend.providerFilter', { defaultValue: 'Provider' })}
            options={uniqueProviders}
            selected={filters.providers}
            onToggle={toggleProvider}
          />
        ) : null}

        {/* License filter */}
        {uniqueLicenses.length > 0 ? (
          <FilterChip
            label={t('runtimeConfig.recommend.licenseFilter', { defaultValue: 'License' })}
            options={uniqueLicenses}
            selected={filters.licenses}
            onToggle={toggleLicense}
          />
        ) : null}

        {/* Sort */}
        <RuntimeSelect
          value={sortKey}
          onChange={(v) => setSortKey(v as RecommendSortKey)}
          options={RECOMMEND_SORT_OPTIONS}
          size="sm"
          className="w-32"
        />

        {/* Result count */}
        <span className="text-xs text-slate-400">
          {sortedItems.length}/{allItems.length}
        </span>
      </div>

      {/* Stale notice */}
      {cacheState === 'stale' ? (
        <Card className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {t('runtimeConfig.recommend.staleNotice', {
            defaultValue: 'Showing the last successful snapshot. Refresh when the model-index worker is reachable again.',
          })}
        </Card>
      ) : null}

      {/* Error state */}
      {error && !feed ? (
        <Card className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          <p className="font-medium">{t('runtimeConfig.recommend.loadFailed', { defaultValue: 'Failed to load recommendation feed.' })}</p>
          <p className="mt-2 text-xs opacity-80">{error}</p>
        </Card>
      ) : null}

      {/* Empty state */}
      {feed && sortedItems.length === 0 && !loading ? (
        <Card className="rounded-xl border border-dashed border-slate-200 bg-white/95 p-6 text-sm text-slate-500">
          {cacheState === 'empty'
            ? t('runtimeConfig.recommend.offlineEmpty', { defaultValue: 'No recommendation snapshot is available yet. Connect the model-index worker, then refresh.' })
            : t('runtimeConfig.recommend.noMatches', { defaultValue: 'Nothing matched the current filters. Try another search term or capability.' })}
        </Card>
      ) : null}

      {/* Column headers */}
      {sortedItems.length > 0 ? (
        <div className="flex items-center gap-3 px-4 text-[10px] font-medium uppercase tracking-wider text-slate-400">
          <span className="w-9 shrink-0" /> {/* icon */}
          <span className="min-w-0 flex-1">{t('runtimeConfig.recommend.colModel', { defaultValue: 'Model' })}</span>
          <span className="hidden w-20 shrink-0 text-center md:block">{t('runtimeConfig.recommend.colLicense', { defaultValue: 'License' })}</span>
          <span className="hidden w-16 shrink-0 text-right md:block">{t('runtimeConfig.recommend.colSize', { defaultValue: 'Size' })}</span>
          <span className="hidden w-20 shrink-0 text-center md:block">{t('runtimeConfig.recommend.colVram', { defaultValue: 'VRAM' })}</span>
          <span className="hidden w-16 shrink-0 text-right lg:block">{t('runtimeConfig.recommend.colCtxLen', { defaultValue: 'Ctx Len' })}</span>
          <span className="hidden w-20 shrink-0 text-right lg:block">{t('runtimeConfig.recommend.colSpeed', { defaultValue: 'Speed' })}</span>
          <span className="w-28 shrink-0 text-right">{t('runtimeConfig.recommend.colGrade', { defaultValue: 'Grade' })}</span>
          <span className="w-4 shrink-0" /> {/* chevron */}
        </div>
      ) : null}

      {/* Model rows */}
      <div className="space-y-2">
        {sortedItems.map((item) => {
          const isExpanded = expandedItemId === item.itemId;
          return (
            <div key={item.itemId}>
              <ModelRow
                item={item}
                totalVramBytes={totalVramBytes}
                expanded={isExpanded}
                onToggle={() => toggleExpand(item.itemId)}
              />
              {isExpanded ? (
                <ModelRowExpanded
                  item={item}
                  totalVramBytes={totalVramBytes}
                  runtimeWritesDisabled={model.runtimeWritesDisabled}
                  planPreview={planPreviewItemId === item.itemId ? planPreview : null}
                  planLoading={planLoadingItemId === item.itemId}
                  planError={planPreviewItemId === item.itemId ? planError : ''}
                  variants={variantItemId === item.itemId ? variants : []}
                  variantsLoading={variantsLoadingItemId === item.itemId}
                  variantsError={variantItemId === item.itemId ? variantsError : ''}
                  installing={installingItemId === item.itemId}
                  onReviewPlan={(it, opts) => void reviewInstallPlan(it, opts)}
                  onOpenVariants={(it) => void openVariants(it)}
                  onOpenLocalModels={openLocalModels}
                  onInstallReviewedPlan={() => void installReviewedPlan()}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
