import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  localRuntime,
  type LocalRuntimeRecommendationFeedItemDescriptor,
} from '@runtime/local-runtime';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { Card } from './runtime-config-primitives';
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
  SelectChip,
  TierSummaryBar,
} from './runtime-config-page-recommend-sections';
import { RecommendDetailPage } from './runtime-config-page-recommend-detail';

type RecommendPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

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
  // Detail view state (internal navigation)
  // ---------------------------------------------------------------------------
  const [selectedDetailItem, setSelectedDetailItem] = useState<LocalRuntimeRecommendationFeedItemDescriptor | null>(null);

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
  // Detail view: if an item is selected, render the detail page
  // ---------------------------------------------------------------------------
  if (selectedDetailItem) {
    return (
      <RecommendDetailPage
        item={selectedDetailItem}
        totalVramBytes={totalVramBytes}
        model={model}
        onBack={() => setSelectedDetailItem(null)}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // List view
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
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)]/70 bg-white/95 px-5 py-3 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--nimi-action-primary-bg)] border-t-transparent" />
          <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.loadingFeed', { defaultValue: 'Detecting hardware\u2026' })}</span>
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
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
            <SearchIcon className="h-4 w-4" />
          </div>
          <input
            value={filters.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('runtimeConfig.recommend.searchPlaceholder', { defaultValue: 'Search models\u2026' })}
            className="h-9 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-white pl-9 pr-3 text-sm text-[var(--nimi-text-primary)] outline-none placeholder:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100"
          />
        </div>

        {/* Capability (Task) */}
        <SelectChip
          label={t('runtimeConfig.recommend.capabilityLabel', { defaultValue: 'Task' })}
          value={capability}
          onChange={(value) => setActiveCapability(normalizeRecommendPageCapability(value))}
          options={RECOMMEND_PAGE_CAPABILITIES.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))}
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
        <SelectChip
          label={t('runtimeConfig.recommend.sortLabel', { defaultValue: 'Sort' })}
          value={sortKey}
          onChange={(v) => setSortKey(v as RecommendSortKey)}
          options={RECOMMEND_SORT_OPTIONS}
        />

        {/* Result count */}
        <span className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
          {sortedItems.length}/{allItems.length}
        </span>
      </div>

      {/* Stale notice */}
      {cacheState === 'stale' ? (
        <Card className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] p-3 text-sm text-[var(--nimi-status-warning)]">
          {t('runtimeConfig.recommend.staleNotice', {
            defaultValue: 'Showing the last successful snapshot. Refresh when the model-index worker is reachable again.',
          })}
        </Card>
      ) : null}

      {/* Error state */}
      {error && !feed ? (
        <Card className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] p-6 text-sm text-[var(--nimi-status-danger)]">
          <p className="font-medium">{t('runtimeConfig.recommend.loadFailed', { defaultValue: 'Failed to load recommendation feed.' })}</p>
          <p className="mt-2 text-xs opacity-80">{error}</p>
        </Card>
      ) : null}

      {/* Empty state */}
      {feed && sortedItems.length === 0 && !loading ? (
        <Card className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] bg-white/95 p-6 text-sm text-[var(--nimi-text-muted)]">
          {cacheState === 'empty'
            ? t('runtimeConfig.recommend.offlineEmpty', { defaultValue: 'No recommendation snapshot is available yet. Connect the model-index worker, then refresh.' })
            : t('runtimeConfig.recommend.noMatches', { defaultValue: 'Nothing matched the current filters. Try another search term or capability.' })}
        </Card>
      ) : null}

      {/* Column headers */}
      {sortedItems.length > 0 ? (
        <div className="flex items-center gap-3 px-4 text-[10px] font-medium uppercase tracking-wider text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
          <span className="min-w-0 flex-1">{t('runtimeConfig.recommend.colModel', { defaultValue: 'Model' })}</span>
          <span className="hidden w-20 shrink-0 text-center md:block">{t('runtimeConfig.recommend.colLicense', { defaultValue: 'License' })}</span>
          <span className="hidden w-16 shrink-0 text-right md:block">{t('runtimeConfig.recommend.colSize', { defaultValue: 'Size' })}</span>
          <span className="hidden w-20 shrink-0 text-center md:block">{t('runtimeConfig.recommend.colVram', { defaultValue: 'VRAM' })}</span>
          <span className="w-28 shrink-0 text-right">{t('runtimeConfig.recommend.colGrade', { defaultValue: 'Grade' })}</span>
          <span className="w-4 shrink-0" /> {/* arrow */}
        </div>
      ) : null}

      {/* Model rows */}
      <div className="space-y-2">
        {sortedItems.map((item) => (
          <ModelRow
            key={item.itemId}
            item={item}
            totalVramBytes={totalVramBytes}
            onSelect={() => setSelectedDetailItem(item)}
          />
        ))}
      </div>
    </div>
  );
}
