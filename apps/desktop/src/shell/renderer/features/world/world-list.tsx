import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useTranslation } from 'react-i18next';
import {
  Bookmark,
  Compass,
  Flame,
  Grid2X2,
  Heart,
  House,
  Landmark,
  Leaf,
  Orbit,
  Search,
  Smile,
  Sparkles,
} from 'lucide-react';
import { Button, EmptyState, LoadingSkeleton, NimiText, ScrollArea, SearchField, Surface } from '@nimiplatform/kit/ui';
import { WorldAlbumCard, WorldAtlasHero, WorldDiscoveryCard, type WorldAtlasTopic } from './world-atlas.js';
import { type WorldListItem } from './world-list-model';
import { selectWorldDiscoverySlots, selectWorldSpotlight } from './world-list-catalog-model.js';

export function WorldsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`min-h-0 flex-1 space-y-6 p-6 ${embedded ? '' : 'h-full'}`} aria-busy="true">
      <LoadingSkeleton lines={2} label={t('World.loading')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Surface key={index} tone="card" padding="lg"><LoadingSkeleton lines={5} /></Surface>)}
      </div>
    </div>
  );
}

export function WorldsLoadError({ embedded = false, offline = false, onRetry }: {
  embedded?: boolean; offline?: boolean; onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return <EmptyState className={embedded ? 'min-h-[220px]' : 'h-full'} title={offline ? t('World.atlas.searchUnavailableOffline') : t('World.loadError')} action={onRetry ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('NotificationPanel.refresh')}</Button> : undefined} />;
}

export type WorldCatalogPaging = {
  totalCount: number; hasMore: boolean; loadingMore: boolean; loadMoreFailed: boolean;
  offlineIncomplete: boolean; onLoadMore: () => void;
};

export const WORLD_TOPIC_ICONS = {
  history: Landmark,
  everyday: House,
  fantasy: Sparkles,
  future: Orbit,
  ecology: Leaf,
  journey: Compass,
  mystery: Search,
  romance: Heart,
  comedy: Smile,
  arena: Flame,
} as const;

export function WorldCatalogContent({ worlds, paging, embedded = false, searchQuery, onSearchQueryChange, railFlap, headerLeading, headerTrailing, topics = [], topicId = '', onTopicChange, topicsFailed = false, onRetryTopics, loading = false, error = false, offline = false, onRetry, favorites = false, onFavoritesSelect, favoritesUnavailable, favoritesPartialError = false, leadWorlds = [], pendingLeadIds = new Set(), spotlightLoading = false, spotlightError = false, onRetrySpotlight }: {
  worlds: WorldListItem[]; paging: WorldCatalogPaging; embedded?: boolean;
  topics?: readonly WorldAtlasTopic[]; topicId?: string; onTopicChange?: (value: string) => void; topicsFailed?: boolean; onRetryTopics?: () => void;
  searchQuery?: string; onSearchQueryChange?: (value: string) => void; railFlap?: ReactNode;
  headerLeading?: ReactNode; headerTrailing?: ReactNode;
  loading?: boolean; error?: boolean; offline?: boolean; onRetry?: () => void;
  favorites?: boolean; onFavoritesSelect?: () => void; favoritesUnavailable?: string; favoritesPartialError?: boolean;
  leadWorlds?: WorldListItem[]; pendingLeadIds?: ReadonlySet<string>; spotlightLoading?: boolean; spotlightError?: boolean; onRetrySpotlight?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const query = searchQuery ?? '';
  const browse = !query.trim() && !topicId && !favorites;
  const spotlightWorlds = browse ? selectWorldSpotlight(worlds, leadWorlds, pendingLeadIds) : [];
  const { slots: discoverySlots, waitingForSpotlight } = browse
    ? selectWorldDiscoverySlots(worlds, leadWorlds, pendingLeadIds, new Set(spotlightWorlds.map(world => world.id)))
    : { slots: [], waitingForSpotlight: false };
  const hasCards = browse ? discoverySlots.length > 0 : worlds.length > 0;
  const viewport = useHomeListPosition(JSON.stringify(['worlds', topicId, query, favorites]), !error && (!loading || hasCards));
  const loadMoreSentinel = useRef<HTMLDivElement>(null);
  const loadMore = useEffectEvent(() => paging.onLoadMore());
  // @nimi-authority: rule.nimi.desktop.product-surfaces.r002
  useEffect(() => {
    const root = viewport.current;
    const sentinel = loadMoreSentinel.current;
    if (!root || !sentinel || loading || waitingForSpotlight || error || offline || paging.offlineIncomplete
      || !paging.hasMore || paging.loadingMore || paging.loadMoreFailed) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return;
      requested = true;
      observer.disconnect();
      loadMore();
    }, { root, rootMargin: `0px 0px ${root.clientHeight}px 0px` });
    observer.observe(sentinel);
    return () => { requested = true; observer.disconnect(); };
  }, [viewport, loading, waitingForSpotlight, error, offline, paging.offlineIncomplete, paging.hasMore,
    paging.loadingMore, paging.loadMoreFailed, worlds.length, query, topicId, favorites, favoritesUnavailable]);
  const selectedTopic = topics.find((topic) => topic.id === topicId);
  const topicTitle = (topic: WorldAtlasTopic) => i18n.language.startsWith('zh') ? topic.title : topic.titleEn;
  return (
    <div data-testid="world-atlas-gallery" data-nimi-density="regular" className={`world-atlas flex min-h-0 min-w-0 flex-1 flex-col ${embedded ? '' : 'p-3'}`}>
      <div className={`world-atlas-header${headerLeading ? ' world-atlas-header-combined' : ''}`}>
        <div className="world-atlas-title">{headerLeading ?? <h1>{t('World.title')}</h1>}{!loading && !error && !favoritesUnavailable ? <NimiText role="caption" className={headerLeading ? 'world-atlas-count' : undefined}>{t('World.atlas.worldCount', { value: paging.totalCount })}</NimiText> : null}</div>
        <div className="world-atlas-tools">
          {topicsFailed ? <Button tone="secondary" size="sm" onClick={onRetryTopics}>{t('World.retryTopics')}</Button> : null}
          <SearchField value={query} onChange={(event) => onSearchQueryChange?.(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onSearchQueryChange?.(''); }}
            onClear={() => onSearchQueryChange?.('')} clearLabel={t('World.clearSearch')}
            placeholder={t('World.searchByNameOrDescription')} aria-label={t('World.searchByNameOrDescription')} className="world-atlas-search" />
          {railFlap}
          {headerTrailing}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportRef={viewport} viewportClassName="world-atlas-viewport bg-transparent" contentClassName="world-atlas-body">
        {browse ? spotlightWorlds.length > 0 ? <WorldAtlasHero worlds={spotlightWorlds} topics={topics} /> : spotlightLoading ? <div className="world-atlas-hero" aria-busy="true"><div className="world-atlas-hero-art"><LoadingSkeleton lines={5} label={t('World.loading')} /></div></div> : spotlightError ? <WorldsLoadError embedded offline={offline} onRetry={onRetrySpotlight} /> : null : null}
        {onTopicChange ? <nav className="world-atlas-filters" aria-label={t('World.topics')}><button type="button" aria-pressed={!topicId && !favorites} onClick={() => onTopicChange('')}><Grid2X2 size={16} />{t('World.allTopics')}</button>{onFavoritesSelect ? <button type="button" aria-pressed={favorites} onClick={onFavoritesSelect}><Bookmark size={16} />{t('World.favorites.title')}</button> : null}{topics.map((topic) => { const Icon = WORLD_TOPIC_ICONS[topic.id as keyof typeof WORLD_TOPIC_ICONS] ?? Compass; return <button key={topic.id} type="button" data-topic-id={topic.id} aria-pressed={!favorites && topicId === topic.id} onClick={() => onTopicChange(topic.id)}><Icon size={16} />{topicTitle(topic)}</button>; })}</nav> : null}
        {favoritesUnavailable ? <EmptyState title={t(favoritesUnavailable)} /> : (loading || waitingForSpotlight) && !discoverySlots.length && !error ? (
          <WorldsLoadingSkeleton embedded />
        ) : error ? (
          <WorldsLoadError embedded offline={offline} onRetry={onRetry} />
        ) : <>
        <section className={`world-atlas-section${browse ? ' world-discovery-section' : ''}`} aria-label={t(favorites ? 'World.favorites.title' : browse ? 'World.album.exploreMore' : 'World.album.allWorlds')}>
          <div className="world-atlas-section-heading"><div><h2>{favorites ? t('World.favorites.title') : query.trim() ? t('World.searchResults') : selectedTopic ? topicTitle(selectedTopic) : t('World.album.exploreMore')}</h2>{favorites ? <NimiText role="caption">{t('World.favorites.localOnly')}</NimiText> : null}</div></div>
          {favoritesPartialError ? <div className="mb-4 flex items-center gap-3" role="status"><NimiText role="helper">{t('World.favorites.partialError')}</NimiText>{!offline ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('NotificationPanel.refresh')}</Button> : null}</div> : null}
          {!hasCards ? <EmptyState title={t(query.trim() ? 'World.noSearchResults' : favorites ? 'World.favorites.empty' : topicId ? 'World.noTopicWorlds' : 'World.noWorlds')} description={favorites && !query.trim() ? t('World.favorites.emptyBody') : undefined} /> : browse ? (
            <div className="world-discovery-grid">{discoverySlots.map(({ id, world }) => world
              ? <WorldDiscoveryCard key={id} world={world} topics={topics} />
              : <div key={id} className="world-discovery-placeholder" aria-hidden="true"><span className="world-atlas-image" /></div>)}</div>
          ) : <div className="world-atlas-grid">{worlds.map(world => <WorldAlbumCard key={world.id} world={world} topics={topics} viewKey={`all:${world.id}`} />)}</div>}
        </section>
        {paging.offlineIncomplete ? <NimiText role="helper" className="mt-4 text-center" aria-live="polite">{t('World.atlas.offlineIncomplete')}</NimiText> : paging.hasMore && !waitingForSpotlight ? (
          <div ref={loadMoreSentinel} className="mt-6 flex min-h-10 flex-col items-center justify-center gap-2" data-testid="world-catalog-load-more" aria-busy={paging.loadingMore}>
            {paging.loadMoreFailed ? <>
              <NimiText role="helper" className="text-[var(--nimi-status-danger)]" aria-live="polite">{t('World.atlas.loadMoreError')}</NimiText>
              <Button tone="secondary" disabled={offline} loading={paging.loadingMore} onClick={paging.onLoadMore}>{t('WorldDetail.paper.gallery.retry')}</Button>
            </> : paging.loadingMore ? <NimiText role="helper" aria-live="polite">{t('World.loading')}</NimiText> : null}
          </div>
        ) : null}
        </>}
      </ScrollArea>
    </div>
  );
}
