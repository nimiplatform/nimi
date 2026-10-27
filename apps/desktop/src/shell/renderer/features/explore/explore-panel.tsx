import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, EmptyState, InlineAlert, LoadingSkeleton, ScrollArea, SearchField } from '@nimiplatform/kit/ui';
import { ArrowLeft, Search } from 'lucide-react';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { ExploreSectionNav, type ExploreSectionId } from './explore-section-nav.js';
import { useExploreCatalogQuery } from './explore-catalog-query.js';
import { characterSourceRefKey } from '../realm-source/realm-source-identity.js';
import { readCharacterCatalog } from './character-catalog-data.js';
import { createRealmWorldData } from '../world/data/realm-world-data.js';
import { WorldCatalogContent, type WorldCatalogPaging } from '../world/world-list.js';
import { WorldAtlasPeople, WorldAtlasTopics } from '../world/world-atlas-data.js';
import { WORLD_CATALOG_CONTRACT_VERSION, fetchWorldCatalogPage, worldCatalogQueryKey } from '../world/world-detail-queries.js';
import { useWorldFavorites } from '../world/use-world-favorites.js';
import { PartnerDirectory } from '../agents/partner-directory.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r002
export function ExplorePanel(props: {
  activeSection: ExploreSectionId; searchText: string;
  onSectionChange(section: ExploreSectionId): void; onSearchTextChange(value: string): void;
}) {
  const { t } = useTranslation();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  const characters = destination.exploreSearchKind === 'characters';
  return <div data-testid="panel:explore" className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 pt-2">
    <header className="flex flex-wrap items-center justify-between gap-3 px-1">
      <ExploreSectionNav active={props.activeSection} onSelect={props.onSectionChange} />
      {props.activeSection === 'worlds' ? <Button tone="ghost" size="sm" onClick={() => { void navigation.push({ ...destination, exploreSearchKind: characters ? 'worlds' : 'characters' }); }}>
        {characters ? <ArrowLeft size={16} /> : <Search size={16} />}{t(characters ? 'runtimeConfig.partners.backWorlds' : 'runtimeConfig.partners.findCharacters')}
      </Button> : null}
    </header>
    {props.activeSection === 'partners' ? <PartnerDirectory /> : characters ? <CharacterDiscovery /> : <WorldDiscovery />}
  </div>;
}

function useSearch(value: string) {
  const [query, setQuery] = useState(value.trim());
  useEffect(() => { const timer = setTimeout(() => setQuery(value.trim()), 300); return () => clearTimeout(timer); }, [value]);
  return query;
}

function WorldDiscovery() {
  const bindings = useDesktopRendererBindings();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  const bootstrapReady = useAppStore(state => state.bootstrapReady);
  const realmBaseUrl = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const networkOffline = useAppStore(state => state.offlineTier !== 'L0');
  const realmWorldData = useMemo(() => createRealmWorldData(bindings.sdk), [bindings.sdk]);
  const worldSearchText = destination.worldSearch ?? '';
  const query = useSearch(worldSearchText);
  const topicId = destination.worldTopicId ?? '';
  const favoritesSelected = destination.worldCollection === 'favorites';
  const setTopic = (value: string) => { void navigation.replace({ ...destination, worldTopicId: value || undefined, worldCollection: undefined }); };
  const favorites = useWorldFavorites({ data: realmWorldData, realmBaseUrl, enabled: bootstrapReady && favoritesSelected, offline: networkOffline, search: query });
  const topics = useQuery({ queryKey: ['world-topics', WORLD_CATALOG_CONTRACT_VERSION, realmBaseUrl], queryFn: () => realmWorldData.loadWorldTopics(), enabled: bootstrapReady && !networkOffline, staleTime: 60_000 });
  const catalog = useExploreCatalogQuery({ queryKey: worldCatalogQueryKey(realmBaseUrl, query, { topicId: topicId || undefined }),
    loadPage: cursor => fetchWorldCatalogPage(realmWorldData, query, cursor, { topicId: topicId || undefined }), enabled: bootstrapReady && !favoritesSelected, networkOffline, staleTime: 30_000 });
  const worlds = useMemo(() => catalog.query.data?.pages.flatMap(page => page.items) ?? [], [catalog.query.data]);
  const paging: WorldCatalogPaging = { totalCount: catalog.query.data?.pages[0]?.totalCount ?? 0, hasMore: Boolean(catalog.query.hasNextPage),
    loadingMore: catalog.query.isFetchingNextPage, loadMoreFailed: catalog.query.isFetchNextPageError,
    offlineIncomplete: catalog.offline && Boolean(catalog.query.data), onLoadMore: () => { void catalog.query.fetchNextPage(); } };
  const source = { data: realmWorldData, realmBaseUrl, enabled: bootstrapReady, offline: networkOffline };
  const renderPeople = (world: (typeof worlds)[number]) => <WorldAtlasPeople world={world} source={source} />;
  return <WorldCatalogContent embedded favorites={favoritesSelected}
    onFavoritesSelect={() => { void navigation.replace({ ...destination, worldTopicId: undefined, worldCollection: 'favorites' }); }}
    favoritesUnavailable={favoritesSelected ? favorites.unavailable : undefined} favoritesPartialError={favoritesSelected && favorites.partialError}
    loading={favoritesSelected ? favorites.loading : catalog.initialLoading} error={favoritesSelected ? favorites.error : catalog.initialUnavailable}
    offline={favoritesSelected ? favorites.offline : catalog.offline} onRetry={() => { if (favoritesSelected) favorites.retry(); else void catalog.query.refetch(); }}
    worlds={favoritesSelected ? favorites.worlds : worlds}
    paging={favoritesSelected ? { totalCount: favorites.worlds.length, hasMore: false, loadingMore: false, loadMoreFailed: false, offlineIncomplete: favorites.offline && favorites.worlds.length > 0, onLoadMore() {} } : paging}
    topics={topics.data ?? []} topicId={topicId} onTopicChange={setTopic} topicsFailed={topics.isError} onRetryTopics={() => { void topics.refetch(); }}
    topicShelves={<WorldAtlasTopics topics={topics.data ?? []} source={source} onSelect={setTopic} renderPeople={renderPeople} />} renderPeople={renderPeople}
    searchQuery={worldSearchText} onSearchQueryChange={worldSearch => { void navigation.replace({ ...destination, worldSearch }); }} />;
}

function CharacterDiscovery() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  const realmBaseUrl = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const accountId = useAppStore(state => state.auth.user?.id ?? '');
  const bootstrapReady = useAppStore(state => state.bootstrapReady);
  const offline = useAppStore(state => state.offlineTier !== 'L0');
  const queryText = destination.search ?? '';
  const query = useSearch(queryText);
  const tooLong = [...query].length > 100;
  const catalog = useExploreCatalogQuery({ queryKey: ['explore-characters', realmBaseUrl, accountId, query],
    loadPage: cursor => readCharacterCatalog(bindings.sdk, query, cursor ?? undefined), enabled: bootstrapReady && !tooLong, networkOffline: offline });
  const items = catalog.query.data?.pages.flatMap(page => page.items) ?? [];
  const viewport = useHomeListPosition(JSON.stringify(['characters', realmBaseUrl, accountId, query]), !catalog.initialLoading);
  return <ScrollArea viewportRef={viewport} className="min-h-0 flex-1" contentClassName="mx-auto max-w-[1120px] space-y-5 p-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-semibold">{t('runtimeConfig.partners.findCharacters')}</h1>
      <SearchField aria-label={t('runtimeConfig.partners.characterSearch')} placeholder={t('runtimeConfig.partners.characterSearch')} value={queryText}
        maxLength={100} onChange={event => { void navigation.replace({ ...destination, search: event.target.value }); }} /></header>
    {tooLong ? <InlineAlert tone="warning">{t('runtimeConfig.partners.searchLimit')}</InlineAlert>
      : catalog.initialLoading ? <LoadingSkeleton lines={5} />
        : catalog.initialUnavailable ? <InlineAlert tone="warning" action={<Button onClick={() => { void catalog.query.refetch(); }}>{t('Common.retry')}</Button>}>{t('runtimeConfig.partners.charactersUnavailable')}</InlineAlert>
          : <>{catalog.offline ? <InlineAlert tone="warning">{t('runtimeConfig.partners.charactersOffline')}</InlineAlert> : null}
            {items.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="explore-character-results">
              {items.map(item => <button key={characterSourceRefKey(item.sourceRef)} data-view-key={characterSourceRefKey(item.sourceRef)} className="flex items-start gap-4 rounded-2xl bg-[var(--nimi-surface-card)] p-5 text-left hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                onClick={() => { void navigation.push({ id: 'source-detail', sourceRef: item.sourceRef }); }}>
                <Avatar alt={item.name} size="lg" src={item.avatarUrl || undefined} fallback={item.name.slice(0, 1)} />
                <span className="min-w-0"><span className="block break-words font-semibold">{item.name}</span><span className="mt-1 block text-xs text-[var(--nimi-text-secondary)]">{item.worldName}</span>
                  {item.summary ? <span className="mt-3 line-clamp-3 text-sm text-[var(--nimi-text-secondary)]">{item.summary}</span> : null}</span>
              </button>)}
            </div> : <EmptyState title={t('runtimeConfig.partners.noCharacters')} />}
            {catalog.query.isFetchNextPageError ? <InlineAlert tone="warning">{t('runtimeConfig.partners.moreFailed')}</InlineAlert> : null}
            {catalog.query.hasNextPage ? <Button disabled={catalog.offline || catalog.query.isFetchingNextPage} onClick={() => { void catalog.query.fetchNextPage(); }}>{t('runtimeConfig.partners.loadMore')}</Button> : null}
          </>}
  </ScrollArea>;
}
