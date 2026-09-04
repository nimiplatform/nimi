import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { InlineAlert, SearchField, Surface, cn } from '@nimiplatform/kit/ui';
import type {
  NimiRuntimeLocalDeviceProfile,
  NimiRuntimeLocalRecommendationFeed,
  NimiRuntimeLocalRecommendationFeedItem,
} from '@nimiplatform/sdk/runtime';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { TOKEN_PANEL_CARD } from './runtime-config-runtime-page-ui';
import {
  RECOMMEND_FEED_FRESH_STALE_MS,
  RECOMMEND_FEED_PAGE_SIZE,
  RECOMMEND_PAGE_CAPABILITIES,
  applyFilters,
  collectUniqueLicenses,
  collectUniqueProviders,
  emptyFilters,
  normalizeRecommendPageCapability,
  recommendationFeedCacheSummary,
  recommendationFeedQueryKey,
  sortRecommendationFeedItems,
  type RecommendFilters,
  type RecommendPageCapability,
  type RecommendSortId,
} from './runtime-config-page-recommend-utils';
import {
  CapabilityTabs,
  DeviceProfileBar,
  FilterChip,
  ModelCard,
  SelectChip,
} from './runtime-config-page-recommend-sections';
import { RecommendDetailPage } from './runtime-config-page-recommend-detail';
import { RuntimePageHeader, RuntimePageShell } from './runtime-config-page-shell';

type RecommendPageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function RecommendPage({ model, state }: RecommendPageProps) {
  const localEnvironmentClient = useRuntimeConfigLocalEnvironmentClient();
  const { t } = useTranslation();
  const capability = normalizeRecommendPageCapability(state.activeCapability);

  // ---------------------------------------------------------------------------
  // Feed state — long cache; hardware + model data rarely change
  // staleTime: fresh snapshots keep the 24h model-index cadence; empty/stale
  // snapshots retry on remount so the page recovers when model-index returns.
  // gcTime Infinity: never evict — manual refresh via "Refresh Hardware" button
  // placeholderData: keepPreviousData so UI renders instantly on capability switch
  // ---------------------------------------------------------------------------
  const feedQuery = useQuery<NimiRuntimeLocalRecommendationFeed<NimiRuntimeLocalDeviceProfile>, Error>({
    queryKey: recommendationFeedQueryKey(capability ?? 'chat'),
    queryFn: () => {
      if (!capability) throw new Error('Recommendation feed capability is not admitted.');
      return localEnvironmentClient.getRecommendationFeed({ capability, pageSize: RECOMMEND_FEED_PAGE_SIZE });
    },
    enabled: capability !== null,
    staleTime: (query) => query.state.data?.cacheState === 'fresh' ? RECOMMEND_FEED_FRESH_STALE_MS : 0,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });
  const feed = feedQuery.data ?? null;
  const loading = feedQuery.isPending && !feedQuery.isPlaceholderData;
  const error = feedQuery.isError
    ? (feedQuery.error instanceof Error ? feedQuery.error.message : String(feedQuery.error || 'Failed to load recommendation feed.'))
    : '';
  const refreshFeed = useCallback(() => { void feedQuery.refetch(); }, [feedQuery]);

  // ---------------------------------------------------------------------------
  // Filter state. Filtering preserves Runtime feed order; sorting is applied
  // on top of the filtered result in renderer memory.
  // ---------------------------------------------------------------------------
  const [filters, setFilters] = useState<RecommendFilters>(emptyFilters);
  const [sort, setSort] = useState<RecommendSortId>('recommended');
  const deferredQuery = useDeferredValue(filters.query);

  // ---------------------------------------------------------------------------
  // Detail view state (internal navigation)
  // ---------------------------------------------------------------------------
  const [selectedDetailItem, setSelectedDetailItem] = useState<NimiRuntimeLocalRecommendationFeedItem | null>(null);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const allItems = feed?.items || [];
  const effectiveFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [filters, deferredQuery]);
  const visibleItems = useMemo(
    () => sortRecommendationFeedItems(applyFilters(allItems, effectiveFilters), sort),
    [allItems, effectiveFilters, sort],
  );
  const uniqueProviders = useMemo(() => collectUniqueProviders(allItems), [allItems]);
  const uniqueLicenses = useMemo(() => collectUniqueLicenses(allItems), [allItems]);
  const cacheState = recommendationFeedCacheSummary(feed);
  const totalVramBytes = feed?.deviceProfile.gpu.totalVramBytes;

  // ---------------------------------------------------------------------------
  // Filter helpers
  // ---------------------------------------------------------------------------
  const setQuery = useCallback((query: string) => setFilters((prev) => ({ ...prev, query })), []);

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

  const capabilityOptions = useMemo(() => RECOMMEND_PAGE_CAPABILITIES.map((value) => ({
    value,
    label: t(`runtimeConfig.recommend.capability.${value}`, { defaultValue: value.charAt(0).toUpperCase() + value.slice(1) }),
  })), [t]);

  const sortOptions = useMemo(() => ([
    { value: 'recommended', label: t('runtimeConfig.recommend.sortRecommended', { defaultValue: 'Best fit' }) },
    { value: 'downloads', label: t('runtimeConfig.recommend.sortDownloads', { defaultValue: 'Most downloads' }) },
    { value: 'size', label: t('runtimeConfig.recommend.sortSmallest', { defaultValue: 'Smallest size' }) },
  ]), [t]);

  if (!capability) {
    return (
      <RuntimePageShell className="space-y-4">
        <RuntimePageHeader title={t('runtimeConfig.sidebar.modelMarket')} />
        <InlineAlert tone="warning" className="px-4 py-3">
          {t('runtimeConfig.recommend.unsupportedCapability', {
            defaultValue: 'This capability has no recommendation feed. Choose Chat, Image, or Video.',
          })}
        </InlineAlert>
        <SelectChip
          label={t('runtimeConfig.recommend.capabilityLabel', { defaultValue: 'Task' })}
          value=""
          onChange={(value) => {
            const next = normalizeRecommendPageCapability(value);
            if (next) setActiveCapability(next);
          }}
          options={capabilityOptions}
        />
      </RuntimePageShell>
    );
  }

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
    <RuntimePageShell>
      <RuntimePageHeader title={t('runtimeConfig.sidebar.modelMarket')} />
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
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-5 py-3 shadow-[var(--nimi-elevation-base)]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--nimi-action-primary-bg)] border-t-transparent" />
          <span className="text-sm text-[var(--nimi-text-muted)]">{t('runtimeConfig.recommend.loadingFeed', { defaultValue: 'Detecting hardware\u2026' })}</span>
        </div>
      )}

      {/* Filter Bar — always visible so the page feels instant */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Capability segmented tabs */}
        <CapabilityTabs
          options={capabilityOptions}
          value={capability}
          onChange={(value) => {
            const next = normalizeRecommendPageCapability(value);
            if (next) setActiveCapability(next);
          }}
        />

        {/* Search */}
        <SearchField
          value={filters.query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('runtimeConfig.recommend.searchPlaceholder', { defaultValue: 'Search models\u2026' })}
          className="min-w-0 flex-1"
        />

        {/* Sort */}
        <SelectChip
          label={t('runtimeConfig.recommend.sortLabel', { defaultValue: 'Sort' })}
          value={sort}
          onChange={(value) => {
            if (value === 'recommended' || value === 'downloads' || value === 'size') setSort(value);
          }}
          contentClassName="w-44 overflow-hidden p-0"
          options={sortOptions}
        />

        {/* License filter */}
        {uniqueLicenses.length > 0 ? (
          <FilterChip
            label={t('runtimeConfig.recommend.licenseFilter', { defaultValue: 'License' })}
            options={uniqueLicenses}
            selected={filters.licenses}
            onToggle={toggleLicense}
          />
        ) : null}

        {/* Provider filter */}
        {uniqueProviders.length > 0 ? (
          <FilterChip
            label={t('runtimeConfig.recommend.providerFilter', { defaultValue: 'Provider' })}
            options={uniqueProviders}
            selected={filters.providers}
            onToggle={toggleProvider}
          />
        ) : null}

        {/* Result count */}
        {!loading ? (
          <span className="text-xs text-[var(--nimi-text-muted)]">
            {visibleItems.length === allItems.length
              ? t('runtimeConfig.recommend.countTotal', { count: allItems.length, defaultValue: '{{count}} models' })
              : t('runtimeConfig.recommend.countFiltered', { visible: visibleItems.length, total: allItems.length, defaultValue: '{{visible}} of {{total}} models' })}
          </span>
        ) : null}
      </div>

      {/* Stale notice */}
      {cacheState === 'stale' ? (
        <InlineAlert tone="warning">
          {t('runtimeConfig.recommend.staleNotice', {
            defaultValue: 'Showing the last successful snapshot. Refresh when the model-index worker is reachable again.',
          })}
        </InlineAlert>
      ) : null}

      {/* Error state */}
      {error && !feed ? (
        <InlineAlert tone="danger" className="px-4 py-3">
          <p className="font-medium">{t('runtimeConfig.recommend.loadFailed', { defaultValue: 'Failed to load recommendation feed.' })}</p>
          <p className="mt-2 text-xs opacity-80">{error}</p>
        </InlineAlert>
      ) : null}

      {/* Empty state */}
      {feed && visibleItems.length === 0 && !loading ? (
        <Surface tone="card" padding="none" className={cn(TOKEN_PANEL_CARD, 'border-dashed p-6 text-sm text-[var(--nimi-text-muted)]')}>
          {cacheState === 'empty'
            ? t('runtimeConfig.recommend.offlineEmpty', { defaultValue: 'No recommendation snapshot is available yet. Connect the model-index worker, then refresh.' })
            : t('runtimeConfig.recommend.noMatches', { defaultValue: 'Nothing matched the current filters. Try another search term or capability.' })}
        </Surface>
      ) : null}

      {/* Model cards — two-column grid on wide screens */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {loading && visibleItems.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="h-4 w-2/3 rounded bg-[var(--nimi-surface-card)]" />
                <div className="h-6 w-20 rounded-full bg-[var(--nimi-surface-card)]" />
              </div>
              <div className="h-3 w-1/3 rounded bg-[var(--nimi-surface-card)]" />
              <div className="flex gap-1.5">
                <div className="h-5 w-14 rounded-full bg-[var(--nimi-surface-card)]" />
                <div className="h-5 w-14 rounded-full bg-[var(--nimi-surface-card)]" />
              </div>
              <div className="h-3 w-full rounded bg-[var(--nimi-surface-card)]" />
            </div>
          ))
        ) : null}
        {visibleItems.map((item) => (
          <ModelCard
            key={item.itemId}
            item={item}
            totalVramBytes={totalVramBytes}
            onSelect={() => setSelectedDetailItem(item)}
          />
        ))}
      </div>
    </RuntimePageShell>
  );
}
