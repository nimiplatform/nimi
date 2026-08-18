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
  RECOMMEND_PAGE_CAPABILITIES,
  applyFilters,
  collectUniqueLicenses,
  collectUniqueProviders,
  emptyFilters,
  normalizeRecommendPageCapability,
  recommendationFeedCacheSummary,
  type RecommendFilters,
  type RecommendPageCapability,
} from './runtime-config-page-recommend-utils';
import {
  DeviceProfileBar,
  FilterChip,
  ModelRow,
  SelectChip,
} from './runtime-config-page-recommend-sections';
import { RecommendDetailPage } from './runtime-config-page-recommend-detail';
import { RuntimePageShell } from './runtime-config-page-shell';

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
    queryKey: ['recommendation-feed', capability],
    queryFn: () => {
      if (!capability) throw new Error('Recommendation feed capability is not admitted.');
      return localEnvironmentClient.getRecommendationFeed({ capability, pageSize: 48 });
    },
    enabled: capability !== null,
    staleTime: (query) => query.state.data?.cacheState === 'fresh' ? 24 * 60 * 60 * 1000 : 0,
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
  // Filter state. Filtering preserves Runtime feed order.
  // ---------------------------------------------------------------------------
  const [filters, setFilters] = useState<RecommendFilters>(emptyFilters);
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
  const visibleItems = useMemo(() => applyFilters(allItems, effectiveFilters), [allItems, effectiveFilters]);
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

  if (!capability) {
    return (
      <RuntimePageShell className="space-y-4">
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
          options={RECOMMEND_PAGE_CAPABILITIES.map((value) => ({
            value,
            label: value.charAt(0).toUpperCase() + value.slice(1),
          }))}
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
    <RuntimePageShell className="space-y-4">
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
        {/* Search */}
        <SearchField
          value={filters.query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('runtimeConfig.recommend.searchPlaceholder', { defaultValue: 'Search models\u2026' })}
          className="min-w-0 flex-1"
        />

        {/* Capability (Task) */}
        <SelectChip
          label={t('runtimeConfig.recommend.capabilityLabel', { defaultValue: 'Task' })}
          value={capability}
          onChange={(value) => {
            const next = normalizeRecommendPageCapability(value);
            if (next) setActiveCapability(next);
          }}
          contentClassName="w-40 overflow-hidden p-0"
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

        {/* Result count */}
        {!loading ? (
          <span className="text-xs text-[var(--nimi-text-muted)]">
            {visibleItems.length}/{allItems.length}
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

      {/* Column headers — show during loading too so the page feels populated */}
      {visibleItems.length > 0 || loading ? (
        <div className="flex items-center gap-3 px-4 text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-wider text-[var(--nimi-text-muted)]">
          <span className="min-w-0 flex-1">{t('runtimeConfig.recommend.colModel', { defaultValue: 'Model' })}</span>
          <span className="hidden w-20 shrink-0 text-center md:block">{t('runtimeConfig.recommend.colLicense', { defaultValue: 'License' })}</span>
          <span className="hidden w-16 shrink-0 text-right md:block">{t('runtimeConfig.recommend.colSize', { defaultValue: 'Size' })}</span>
          <span className="hidden w-20 shrink-0 text-center md:block">{t('runtimeConfig.recommend.colVram', { defaultValue: 'VRAM' })}</span>
          <span className="w-28 shrink-0 text-right">{t('runtimeConfig.recommend.colRecommendation', { defaultValue: 'Recommendation' })}</span>
          <span className="w-4 shrink-0" /> {/* arrow */}
        </div>
      ) : null}

      {/* Model rows */}
      <div className="space-y-2">
        {loading && visibleItems.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-48 rounded bg-[var(--nimi-surface-card)]" />
                <div className="h-3 w-32 rounded bg-[var(--nimi-surface-card)]" />
              </div>
              <div className="hidden w-20 md:block"><div className="mx-auto h-3 w-14 rounded bg-[var(--nimi-surface-card)]" /></div>
              <div className="hidden w-16 md:block"><div className="ml-auto h-3 w-10 rounded bg-[var(--nimi-surface-card)]" /></div>
              <div className="hidden w-20 md:block"><div className="mx-auto h-3 w-12 rounded bg-[var(--nimi-surface-card)]" /></div>
              <div className="w-28"><div className="ml-auto h-6 w-16 rounded-full bg-[var(--nimi-surface-card)]" /></div>
              <div className="w-4" />
            </div>
          ))
        ) : null}
        {visibleItems.map((item) => (
          <ModelRow
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
