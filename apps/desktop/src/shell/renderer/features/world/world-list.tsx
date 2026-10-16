import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Compass, Grid2X2, Landmark, Leaf, Orbit, Sparkles, House, X } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, ScrollArea, SearchField, Surface } from '@nimiplatform/kit/ui';
import { WorldAlbumCard, WorldAtlasHero, type WorldAtlasTopic, type WorldPeopleRenderer } from './world-atlas.js';
import type { WorldListItem } from './world-list-model';

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

const topicIcons = { history: Landmark, everyday: House, fantasy: Sparkles, future: Orbit, ecology: Leaf, journey: Compass };

export function WorldCatalogContent({ worlds, paging, embedded = false, searchQuery, onSearchQueryChange, railFlap, topics = [], topicId = '', onTopicChange, topicsFailed = false, onRetryTopics, topicShelves, renderPeople, loading = false, error = false, offline = false, onRetry, favorites = false, onFavoritesSelect, favoritesUnavailable, favoritesPartialError = false }: {
  worlds: WorldListItem[]; paging: WorldCatalogPaging; embedded?: boolean;
  topics?: readonly WorldAtlasTopic[]; topicId?: string; onTopicChange?: (value: string) => void; topicsFailed?: boolean; onRetryTopics?: () => void;
  searchQuery?: string; onSearchQueryChange?: (value: string) => void; railFlap?: ReactNode;
  topicShelves?: ReactNode; renderPeople?: WorldPeopleRenderer;
  loading?: boolean; error?: boolean; offline?: boolean; onRetry?: () => void;
  favorites?: boolean; onFavoritesSelect?: () => void; favoritesUnavailable?: string; favoritesPartialError?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const query = searchQuery ?? '';
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => { viewport.current?.scrollTo({ top: 0 }); }, [topicId, query, favorites]);
  const browse = !query.trim() && !topicId && !favorites;
  const selectedTopic = topics.find((topic) => topic.id === topicId);
  const topicTitle = (topic: WorldAtlasTopic) => i18n.language.startsWith('zh') ? topic.title : topic.titleEn;
  return (
    <div data-testid="world-atlas-gallery" data-nimi-density="regular" className={`world-atlas flex min-h-0 min-w-0 flex-1 flex-col ${embedded ? '' : 'p-3'}`}>
      <div className="world-atlas-header">
        <div><div className="world-atlas-title"><h1>{t('World.title')}</h1>{!loading && !error && !favoritesUnavailable ? <NimiText role="caption">{t('World.atlas.worldCount', { value: paging.totalCount })}</NimiText> : null}</div></div>
        <div className="world-atlas-tools">
          {topicsFailed ? <Button tone="secondary" size="sm" onClick={onRetryTopics}>{t('World.retryTopics')}</Button> : null}
          <SearchField value={query} onChange={(event) => onSearchQueryChange?.(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onSearchQueryChange?.(''); }} placeholder={t('World.searchByNameOrDescription')} aria-label={t('World.searchByNameOrDescription')} className="world-atlas-search" />
          {query ? <IconButton tone="ghost" size="sm" icon={<X size={15} />} aria-label={t('World.clearSearch')} onClick={() => onSearchQueryChange?.('')} /> : null}
          {railFlap}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportRef={viewport} viewportClassName="bg-transparent" contentClassName="world-atlas-body">
        {browse && !loading && !error ? <WorldAtlasHero worlds={worlds} /> : null}
        {onTopicChange ? <nav className="world-atlas-filters" aria-label={t('World.topics')}><button aria-pressed={!topicId && !favorites} onClick={() => onTopicChange('')}><Grid2X2 size={17} />{t('World.allTopics')}</button>{onFavoritesSelect ? <button aria-pressed={favorites} onClick={onFavoritesSelect}><Bookmark size={17} />{t('World.favorites.title')}</button> : null}{topics.map((topic) => { const Icon = topicIcons[topic.id as keyof typeof topicIcons] ?? Compass; return <button key={topic.id} aria-pressed={!favorites && topicId === topic.id} onClick={() => onTopicChange(topic.id)}><Icon size={17} />{topicTitle(topic)}</button>; })}</nav> : null}
        {favoritesUnavailable ? <EmptyState title={t(favoritesUnavailable)} /> : loading ? (
          <WorldsLoadingSkeleton embedded />
        ) : error ? (
          <WorldsLoadError embedded offline={offline} onRetry={onRetry} />
        ) : <>
        {browse ? topicShelves : null}
        <section className="world-atlas-section" aria-label={t(favorites ? 'World.favorites.title' : 'World.album.allWorlds')}>
          <div className="world-atlas-section-heading"><div><h2>{favorites ? t('World.favorites.title') : query.trim() ? t('World.searchResults') : selectedTopic ? topicTitle(selectedTopic) : t('World.album.allWorlds')}</h2>{favorites ? <NimiText role="caption">{t('World.favorites.localOnly')}</NimiText> : null}</div></div>
          {favoritesPartialError ? <div className="mb-4 flex items-center gap-3" role="status"><NimiText role="helper">{t('World.favorites.partialError')}</NimiText>{!offline ? <Button tone="secondary" size="sm" onClick={onRetry}>{t('NotificationPanel.refresh')}</Button> : null}</div> : null}
          {!worlds.length ? <EmptyState title={t(query.trim() ? 'World.noSearchResults' : favorites ? 'World.favorites.empty' : topicId ? 'World.noTopicWorlds' : 'World.noWorlds')} description={favorites && !query.trim() ? t('World.favorites.emptyBody') : undefined} /> : <div className="world-atlas-grid">{worlds.map((world) => <WorldAlbumCard key={world.id} world={world} renderPeople={renderPeople} />)}</div>}
        </section>
        {paging.offlineIncomplete ? <NimiText role="helper" className="mt-4 text-center" aria-live="polite">{t('World.atlas.offlineIncomplete')}</NimiText> : paging.hasMore ? (
          <div className="mt-6 flex flex-col items-center gap-2" data-testid="world-catalog-load-more">
            {paging.loadMoreFailed ? <NimiText role="helper" className="text-[var(--nimi-status-danger)]" aria-live="polite">{t('World.atlas.loadMoreError')}</NimiText> : null}
            <Button tone="secondary" loading={paging.loadingMore} onClick={paging.onLoadMore}>{t(paging.loadMoreFailed ? 'WorldDetail.paper.gallery.retry' : 'World.atlas.loadMore')}</Button>
          </div>
        ) : null}
        </>}
      </ScrollArea>
    </div>
  );
}
