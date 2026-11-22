import { useState, useEffect, useEffectEvent, useMemo, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { Button, EmptyState, InlineAlert, LoadingSkeleton, NimiText, ScrollArea, SearchField } from '@nimiplatform/kit/ui';
import { Compass, Grid2X2, UsersRound } from 'lucide-react';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useHomeListPosition } from '../../app-shell/providers/use-home-list-position.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { ExploreSectionNav, type ExploreSectionId } from './explore-section-nav.js';
import { useExploreCatalogQuery } from './explore-catalog-query.js';
import { characterSourceRefKey } from '../realm-source/realm-source-identity.js';
import { interleaveCharactersByWorld, readCharacterCatalog } from './character-catalog-data.js';
import { CharacterVoicePreviewButton, stopCharacterVoicePreview } from './character-voice-preview.js';
import { createRealmWorldData } from '../world/data/realm-world-data.js';
import { WORLD_TOPIC_ICONS, WorldCatalogContent, type WorldCatalogPaging } from '../world/world-list.js';
import type { WorldAtlasTopic } from '../world/world-atlas.js';
import { useWorldAtlasLeadWorlds } from '../world/world-atlas-data.js';
import { selectWorldCatalogWorlds } from '../world/world-list-catalog-model.js';
import { WORLD_CATALOG_CONTRACT_VERSION, fetchWorldCatalogPage, worldCatalogQueryKey } from '../world/world-detail-queries.js';
import { useWorldFavorites } from '../world/use-world-favorites.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r002
export function ExplorePanel(props: {
  activeSection: ExploreSectionId; searchText: string;
  onSectionChange(section: ExploreSectionId): void; onSearchTextChange(value: string): void;
}) {
  const { t } = useTranslation();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  const characters = destination.exploreSearchKind === 'characters';
  const handleSectionSelect = (section: ExploreSectionId) => {
    if (characters) {
      void navigation.push({
        ...destination,
        exploreSection: section,
        exploreSearchKind: undefined,
        exploreWorldId: undefined,
        exploreTopicId: undefined,
      });
      return;
    }
    props.onSectionChange(section);
  };
  const sectionNav = <ExploreSectionNav active={props.activeSection} onSelect={handleSectionSelect} />;
  const partnerAction = <Button
    tone={characters ? 'secondary' : 'ghost'}
    size="sm"
    className="shrink-0"
    aria-pressed={characters}
    onClick={() => {
      void navigation.push({ ...destination, exploreSearchKind: characters ? undefined : 'characters', exploreWorldId: undefined, exploreTopicId: undefined });
    }}
  >
    <UsersRound size={17} />{t('runtimeConfig.partners.discoverPartners')}
  </Button>;
  return <div data-testid="panel:explore" className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 pt-2">
    {props.activeSection === 'worlds' && !characters ? null : <header className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center justify-between gap-3 px-5 pt-1">
      <div className="flex items-center gap-7">
        {sectionNav}
        {partnerAction}
      </div>
    </header>}
    {characters ? <CharacterDiscovery /> : <WorldDiscovery headerLeading={sectionNav} headerTrailing={partnerAction} />}
  </div>;
}

function useSearch(value: string) {
  const [query, setQuery] = useState(value.trim());
  useEffect(() => { const timer = setTimeout(() => setQuery(value.trim()), 300); return () => clearTimeout(timer); }, [value]);
  return query;
}

function WorldDiscovery({ headerLeading, headerTrailing }: { headerLeading: ReactNode; headerTrailing: ReactNode }) {
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
  const worlds = useMemo(() => selectWorldCatalogWorlds(catalog.query.data?.pages ?? [], worldSearchText, topicId), [catalog.query.data, worldSearchText, topicId]);
  const paging: WorldCatalogPaging = { totalCount: catalog.query.data?.pages[0]?.totalCount ?? 0, hasMore: Boolean(catalog.query.hasNextPage),
    loadingMore: catalog.query.isFetchingNextPage, loadMoreFailed: catalog.query.isFetchNextPageError,
    offlineIncomplete: catalog.offline && Boolean(catalog.query.data), onLoadMore: () => { void catalog.query.fetchNextPage(); } };
  const source = { data: realmWorldData, realmBaseUrl, enabled: bootstrapReady, offline: networkOffline };
  const spotlight = useWorldAtlasLeadWorlds({ ...source, enabled: bootstrapReady && !favoritesSelected && !topicId && !worldSearchText.trim() }, (catalog.query.data?.pages.length ?? 0) > 1);
  return <WorldCatalogContent embedded favorites={favoritesSelected} headerLeading={headerLeading} headerTrailing={headerTrailing}
    onFavoritesSelect={() => { void navigation.replace({ ...destination, worldTopicId: undefined, worldCollection: 'favorites' }); }}
    favoritesUnavailable={favoritesSelected ? favorites.unavailable : undefined} favoritesPartialError={favoritesSelected && favorites.partialError}
    loading={favoritesSelected ? favorites.loading : catalog.initialLoading} error={favoritesSelected ? favorites.error : catalog.initialUnavailable}
    offline={favoritesSelected ? favorites.offline : catalog.offline} onRetry={() => { if (favoritesSelected) favorites.retry(); else void catalog.query.refetch(); }}
    worlds={favoritesSelected ? favorites.worlds : worlds}
    pendingLeadIds={spotlight.pendingIds} leadWorlds={spotlight.worlds} spotlightLoading={spotlight.loading} spotlightError={spotlight.error} onRetrySpotlight={spotlight.retry}
    paging={favoritesSelected ? { totalCount: favorites.worlds.length, hasMore: false, loadingMore: false, loadMoreFailed: false, offlineIncomplete: favorites.offline && favorites.worlds.length > 0, onLoadMore() {} } : paging}
    topics={topics.data ?? []} topicId={topicId} onTopicChange={setTopic} topicsFailed={topics.isError} onRetryTopics={() => { void topics.refetch(); }}
    searchQuery={worldSearchText} onSearchQueryChange={worldSearch => { void navigation.replace({ ...destination, worldSearch }); }} />;
}

function CharacterDiscovery() {
  const { t, i18n } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  const realmBaseUrl = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const accountId = useAppStore(state => state.auth.user?.id ?? '');
  const bootstrapReady = useAppStore(state => state.bootstrapReady);
  const offline = useAppStore(state => state.offlineTier !== 'L0');
  const realmWorldData = useMemo(() => createRealmWorldData(bindings.sdk), [bindings.sdk]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadMoreSentinel = useRef<HTMLDivElement>(null);
  const queryText = destination.search ?? '';
  const query = useSearch(queryText);
  const selectedWorldId = destination.exploreWorldId ?? '';
  const selectedTopicId = destination.exploreTopicId ?? '';
  const tooLong = [...query].length > 100;
  const diversifyAcrossWorlds = !query && !selectedWorldId;

  useEffect(() => () => { stopCharacterVoicePreview(); }, []);

  const topicsQuery = useQuery({
    queryKey: ['world-topics', WORLD_CATALOG_CONTRACT_VERSION, realmBaseUrl],
    queryFn: () => realmWorldData.loadWorldTopics(),
    enabled: bootstrapReady && !offline,
    staleTime: 60_000,
  });

  const worldFilters = { topicId: selectedTopicId || undefined };
  const worldCatalog = useExploreCatalogQuery({
    queryKey: worldCatalogQueryKey(realmBaseUrl, '', worldFilters),
    loadPage: cursor => fetchWorldCatalogPage(realmWorldData, '', cursor, worldFilters),
    enabled: bootstrapReady && !offline,
    networkOffline: offline,
    staleTime: 30_000,
  });

  const catalog = useExploreCatalogQuery({
    queryKey: ['explore-characters', realmBaseUrl, accountId, query, selectedWorldId, selectedTopicId],
    loadPage: cursor => readCharacterCatalog(
      bindings.sdk,
      query,
      cursor ?? undefined,
      selectedWorldId || undefined,
      {
        topicId: selectedTopicId || undefined,
        limit: diversifyAcrossWorlds ? 100 : 24,
      },
    ),
    enabled: bootstrapReady && !tooLong,
    networkOffline: offline,
  });
  const items = useMemo(() => {
    const pages = catalog.query.data?.pages ?? [];
    if (!diversifyAcrossWorlds) {
      return pages.flatMap(page => page.items);
    }
    return pages.flatMap(page => interleaveCharactersByWorld(page.items));
  }, [catalog.query.data, diversifyAcrossWorlds]);
  const totalCount = catalog.query.data?.pages[0]?.totalCount ?? 0;
  const viewport = useHomeListPosition(
    JSON.stringify(['characters', realmBaseUrl, accountId, query, selectedWorldId, selectedTopicId]),
    !catalog.initialLoading,
  );
  const loadMore = useEffectEvent(() => { void catalog.query.fetchNextPage(); });

  useEffect(() => {
    const root = viewport.current;
    const sentinel = loadMoreSentinel.current;
    if (!root || !sentinel || catalog.initialLoading || catalog.initialUnavailable || catalog.offline
      || !catalog.query.hasNextPage || catalog.query.isFetchingNextPage || catalog.query.isFetchNextPageError) return;
    let requested = false;
    const observer = new IntersectionObserver((entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return;
      requested = true;
      observer.disconnect();
      loadMore();
    }, { root, rootMargin: `0px 0px ${Math.max(root.clientHeight, 320)}px 0px` });
    observer.observe(sentinel);
    return () => { requested = true; observer.disconnect(); };
  }, [viewport, catalog.initialLoading, catalog.initialUnavailable, catalog.offline, catalog.query.hasNextPage,
    catalog.query.isFetchingNextPage, catalog.query.isFetchNextPageError, items.length, query, selectedWorldId, selectedTopicId]);

  const topics = topicsQuery.data ?? [];
  const worldOptions = worldCatalog.query.data?.pages.flatMap(page => page.items) ?? [];
  const selectedWorld = worldOptions.find(world => world.id === selectedWorldId);
  const topicTitle = (topic: WorldAtlasTopic) => (i18n.language.startsWith('zh') ? topic.title : topic.titleEn);

  const handleTopicChange = (topicId: string) => {
    void navigation.replace({
      ...destination,
      exploreTopicId: topicId || undefined,
      exploreWorldId: !topicId || topicId === selectedTopicId || selectedWorld?.topicIds?.includes(topicId)
        ? destination.exploreWorldId : undefined,
    });
  };

  return <ScrollArea viewportRef={viewport} className="min-h-0 flex-1" contentClassName="mx-auto max-w-[1480px] space-y-5 px-5 pb-8 pt-2">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{t('runtimeConfig.partners.findCharacters')}</h1>
        {!catalog.initialLoading && !catalog.initialUnavailable && !tooLong ? (
          <NimiText role="caption" data-testid="explore-character-count">{t('WorldDetail.discovery.peopleCount', { count: totalCount })}</NimiText>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {worldOptions.length > 0 || selectedWorldId ? (
          <select
            aria-label={t('World.title')}
            data-testid="explore-character-world-filter"
            value={selectedWorldId}
            onChange={(event) => { void navigation.replace({ ...destination, exploreWorldId: event.target.value || undefined }); }}
            className="h-9 max-w-[240px] rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3.5 text-sm text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            <option value="">{t('World.allTopics')}</option>
            {selectedWorldId && !selectedWorld ? (
              <option value={selectedWorldId}>{items[0]?.worldName || t('World.selectedWorld')}</option>
            ) : null}
            {worldOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        ) : null}
        {worldCatalog.initialUnavailable || worldCatalog.query.isFetchNextPageError ? (
          <InlineAlert tone="warning" action={worldCatalog.offline ? undefined : <Button size="sm" onClick={() => {
            if (worldCatalog.query.isFetchNextPageError) void worldCatalog.query.fetchNextPage();
            else void worldCatalog.query.refetch();
          }}>{t('Common.retry')}</Button>}>
            {t(worldCatalog.query.isFetchNextPageError ? 'World.atlas.loadMoreError' : 'World.loadError')}
          </InlineAlert>
        ) : worldCatalog.query.hasNextPage ? (
          <Button size="sm" tone="secondary" disabled={worldCatalog.offline || worldCatalog.query.isFetchingNextPage}
            loading={worldCatalog.query.isFetchingNextPage} onClick={() => { void worldCatalog.query.fetchNextPage(); }}>
            {t('World.atlas.loadMore')}
          </Button>
        ) : null}
        <SearchField
          ref={searchInputRef}
          className="w-full sm:w-72"
          aria-label={t('runtimeConfig.partners.characterSearch')}
          placeholder={t('runtimeConfig.partners.characterSearch')}
          value={queryText}
          maxLength={100}
          onChange={event => { void navigation.replace({ ...destination, search: event.target.value }); }}
          onClear={() => { void navigation.replace({ ...destination, search: '' }); }}
          clearLabel={t('Common.clear')}
        />
      </div>
    </header>
    {topics.length > 0 ? (
      <nav className="flex flex-wrap gap-2" aria-label={t('World.topics')} data-testid="explore-character-topic-filters">
        <button
          type="button"
          aria-pressed={!selectedTopicId}
          onClick={() => handleTopicChange('')}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
            !selectedTopicId
              ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-surface-canvas)] shadow-sm'
              : 'bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,var(--nimi-action-primary-bg)_12%)] text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
          }`}
        >
          <Grid2X2 size={15} />{t('World.anyTopic')}
        </button>
        {topics.map((topic) => {
          const Icon = WORLD_TOPIC_ICONS[topic.id as keyof typeof WORLD_TOPIC_ICONS] ?? Compass;
          const active = selectedTopicId === topic.id;
          return (
            <button
              key={topic.id}
              type="button"
              data-topic-id={topic.id}
              aria-pressed={active}
              onClick={() => handleTopicChange(topic.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
                active
                  ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-surface-canvas)] shadow-sm'
                  : 'bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,var(--nimi-action-primary-bg)_12%)] text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
              }`}
            >
              <Icon size={15} />{topicTitle(topic)}
            </button>
          );
        })}
      </nav>
    ) : null}
    {tooLong ? <InlineAlert tone="warning">{t('runtimeConfig.partners.searchLimit')}</InlineAlert>
      : catalog.initialLoading ? <LoadingSkeleton lines={5} />
        : catalog.initialUnavailable ? <InlineAlert tone="warning" action={<Button onClick={() => { void catalog.query.refetch(); }}>{t('Common.retry')}</Button>}>{t('runtimeConfig.partners.charactersUnavailable')}</InlineAlert>
          : <>{catalog.offline ? <InlineAlert tone="warning">{t('runtimeConfig.partners.charactersOffline')}</InlineAlert> : null}
            {items.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="explore-character-results">
              {items.map(item => (
                <article
                  key={characterSourceRefKey(item.sourceRef)}
                  data-view-key={characterSourceRefKey(item.sourceRef)}
                  className="group relative flex flex-col justify-between rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] transition-colors hover:bg-[var(--nimi-surface-active)]"
                >
                  <button
                    type="button"
                    className="flex flex-1 items-start gap-4 p-5 text-left focus-visible:rounded-2xl focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                    onClick={() => { stopCharacterVoicePreview(); void navigation.push({ id: 'source-detail', sourceRef: item.sourceRef }); }}
                  >
                    <span className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[color-mix(in_srgb,var(--nimi-surface-panel)_88%,var(--nimi-action-primary-bg)_12%)] text-lg font-semibold text-[var(--nimi-text-secondary)]">
                      <MediaImage
                        delivery={item.avatarMedia}
                        externalUrl={item.avatarUrl}
                        purpose="avatar"
                        sizes="80px"
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                        fallback={item.name.slice(0, 1)}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[16px] font-semibold leading-snug text-[var(--nimi-text-primary)]">{item.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
                        <span className="truncate font-medium">{item.worldName}</span>
                        {item.role ? <span className="rounded-full bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[11px]">{item.role}</span> : null}
                      </span>
                      {item.summary ? <span className="mt-2.5 line-clamp-3 block text-sm leading-relaxed text-[var(--nimi-text-secondary)]">{item.summary}</span> : null}
                    </span>
                  </button>
                  {item.voiceSampleUrl ? (
                    <div className="flex justify-end px-4 pb-3.5 pt-0">
                      <CharacterVoicePreviewButton src={item.voiceSampleUrl} characterName={item.name} variant="surface" />
                    </div>
                  ) : null}
                </article>
              ))}
            </div> : <EmptyState title={t('runtimeConfig.partners.noCharacters')} />}
            {catalog.query.isFetchNextPageError ? <InlineAlert tone="warning" action={<Button size="sm" tone="secondary" onClick={() => { void catalog.query.fetchNextPage(); }}>{t('Common.retry')}</Button>}>{t('runtimeConfig.partners.moreFailed')}</InlineAlert> : null}
            {catalog.query.hasNextPage ? (
              <div ref={loadMoreSentinel} className="flex min-h-10 items-center justify-center py-2" data-testid="explore-characters-load-more">
                <Button tone="secondary" size="sm" disabled={catalog.offline || catalog.query.isFetchingNextPage} loading={catalog.query.isFetchingNextPage} onClick={() => { void catalog.query.fetchNextPage(); }}>
                  {t('runtimeConfig.partners.loadMore')}
                </Button>
              </div>
            ) : null}
          </>}
  </ScrollArea>;
}
