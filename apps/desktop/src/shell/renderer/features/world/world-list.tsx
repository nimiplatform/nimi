import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, X } from 'lucide-react';
import { Button, EmptyState, IconButton, LoadingSkeleton, NimiText, ScrollArea, SearchField, Surface } from '@nimiplatform/kit/ui';
import { WorldCover } from './world-list-cover.js';
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

export function WorldCatalogContent({ worlds, paging, embedded = false, searchQuery, onSearchQueryChange, railFlap }: {
  worlds: WorldListItem[]; paging: WorldCatalogPaging; embedded?: boolean;
  searchQuery?: string; onSearchQueryChange?: (value: string) => void; railFlap?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const query = searchQuery ?? '';
  return (
    <div data-testid="world-atlas-gallery" data-nimi-density="regular" className={`flex min-h-0 min-w-0 flex-1 flex-col ${embedded ? '' : 'p-3'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3"><NimiText role="section-title">{t('World.title')}</NimiText><NimiText role="caption">{t('World.atlas.worldCount', { value: paging.totalCount })}</NimiText></div>
        <div className="flex flex-wrap items-center gap-3">
          <SearchField value={query} onChange={(event) => onSearchQueryChange?.(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') onSearchQueryChange?.(''); }} placeholder={t('World.searchByNameOrDescription')} aria-label={t('World.searchByNameOrDescription')} className="w-72" />
          {query ? <IconButton tone="ghost" size="sm" icon={<X size={15} />} aria-label={t('World.clearSearch')} onClick={() => onSearchQueryChange?.('')} /> : null}
          {railFlap}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" contentClassName="mx-auto w-full max-w-[1440px] px-4 pb-6 pt-2">
        {!worlds.length ? <EmptyState title={t(query ? 'World.noSearchResults' : 'World.noWorlds')} /> : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))' }}>
            {worlds.map((world) => (
              <Surface key={world.id} as="article" tone="card" padding="none" className="flex min-w-0 flex-col overflow-hidden shadow-none" data-testid="world-discovery-card">
                <WorldCover world={world} variant="catalog" />
                <div className="flex flex-1 flex-col items-start gap-3 p-4">
                  <NimiText role="section-title" className="line-clamp-2 break-words" title={world.name}>{world.name}</NimiText>
                  {world.genre || world.era ? <NimiText role="caption" className="line-clamp-1">{[world.genre, world.era].filter(Boolean).join(' · ')}</NimiText> : null}
                  {world.tagline || world.description ? <NimiText role="body" className="line-clamp-2 break-words">{world.tagline || world.description}</NimiText> : null}
                  <div className="mt-auto flex w-full flex-wrap items-center justify-between gap-2 pt-2">
                    <NimiText role="caption">{t('WorldDetail.discovery.peopleCount', { count: world.characterCount + world.personaCharacterCount })}</NimiText>
                    <Button tone="secondary" size="sm" trailingIcon={<ArrowRight size={14} />} onClick={() => void navigation.push({ id: 'world-detail', worldId: world.id })} aria-label={t('WorldDetail.discovery.enterNamedWorld', { name: world.name })}>{t('WorldDetail.discovery.enterWorld')}</Button>
                  </div>
                </div>
              </Surface>
            ))}
          </div>
        )}
        {paging.offlineIncomplete ? <NimiText role="helper" className="mt-4 text-center" aria-live="polite">{t('World.atlas.offlineIncomplete')}</NimiText> : paging.hasMore ? (
          <div className="mt-6 flex flex-col items-center gap-2" data-testid="world-catalog-load-more">
            {paging.loadMoreFailed ? <NimiText role="helper" className="text-[var(--nimi-status-danger)]" aria-live="polite">{t('World.atlas.loadMoreError')}</NimiText> : null}
            <Button tone="secondary" loading={paging.loadingMore} onClick={paging.onLoadMore}>{t(paging.loadMoreFailed ? 'WorldDetail.paper.gallery.retry' : 'World.atlas.loadMore')}</Button>
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
