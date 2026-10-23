import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useExploreCatalogQuery } from './explore-catalog-query.js';
import { createRealmExploreData } from './data/realm-explore-data';
import { createRealmWorldData } from '../world/data/realm-world-data.js';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { ExploreView } from './explore-view';
import type { ExplorePersonaSourceCardData } from './explore-cards';
import type { ExploreSectionId } from './explore-section-nav';
import { parsePersonaSources } from './explore-persona-source-projection';
import { WORLD_CATALOG_CONTRACT_VERSION, fetchWorldCatalogPage, worldCatalogQueryKey } from '../world/world-detail-queries.js';
import type { WorldCatalogPaging } from '../world/world-list';
import { WorldAtlasPeople, WorldAtlasTopics } from '../world/world-atlas-data.js';
import type { WorldListItem } from '../world/world-list-model.js';
import { useWorldFavorites } from '../world/use-world-favorites.js';
import { characterSourceMaterializationFailureMessage, characterSourceRefKey, describeCharacterPrimaryAction, discoverCharacterSourceLocalAgents, resolveCharacterSourceState } from './character-source-materialization';
import { CharacterSourceConfirmationPendingError, confirmCharacterSourceMaterialized, ensureCharacterSourceMaterialized } from '../relationship/character-source-launch-target.js';
import { resolveAgentTargetSnapshotForSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { localAgentListQueryKey } from '../agents/local-agent-list-model';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';


const PAGE_SIZE = 20;

type ExplorePanelProps = {
  activeSection: ExploreSectionId;
  searchText: string;
  onSectionChange: (section: ExploreSectionId) => void;
  onSearchTextChange: (value: string) => void;
};

// @nimi-authority: definition.nimi.desktop.product-surfaces.explore
// @nimi-authority: rule.nimi.desktop.product-surfaces.r001
export function ExplorePanel(props: ExplorePanelProps) {

  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const bindings = useDesktopRendererBindings();
  const appStore = useAppStoreApi();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const realmExploreData = useMemo(
    () => createRealmExploreData(bindings.sdk),
    [bindings.sdk],
  );
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());

  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setFeedback = emitFeedbackToast;
  const sourceActionsInFlight = useRef(new Set<string>());
  const [sourceActionStates, setSourceActionStates] = useState<Record<string, 'running' | 'refresh'>>({});

  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const networkOffline = useAppStore((state) => state.offlineTier !== 'L0');
  const realmWorldData = useMemo(() => createRealmWorldData(bindings.sdk), [bindings.sdk]);
  const worldAtlasSource = { data: realmWorldData, realmBaseUrl, enabled: bootstrapReady, offline: networkOffline };
  const renderWorldPeople = (world: WorldListItem) => <WorldAtlasPeople world={world} source={worldAtlasSource} />;

  // The world rail owns its own search; worlds and personas never share one query string.
  const worldSearchText = destination.worldSearch ?? '';
  const setWorldSearchText = (value: string) => { void navigation.replace({ ...destination, worldSearch: value }); };
  const worldQuery = useDebouncedSearch(worldSearchText);
  const worldTopicId = destination.worldTopicId ?? '';
  const worldFavorites = destination.worldCollection === 'favorites';
  const setWorldTopicId = (value: string) => { void navigation.replace({ ...destination, worldTopicId: value || undefined, worldCollection: undefined }); };
  const selectWorldFavorites = () => { void navigation.replace({ ...destination, worldTopicId: undefined, worldCollection: 'favorites' }); };
  const favorites = useWorldFavorites({ data: realmWorldData, realmBaseUrl, enabled: bootstrapReady && worldFavorites, offline: networkOffline, search: worldQuery });
  const worldTopics = useQuery({ queryKey: ['world-topics', WORLD_CATALOG_CONTRACT_VERSION, realmBaseUrl], queryFn: () => realmWorldData.loadWorldTopics(), enabled: bootstrapReady && !networkOffline, staleTime: 60_000 });
  const worldCatalog = useExploreCatalogQuery({
    queryKey: worldCatalogQueryKey(realmBaseUrl, worldQuery, { topicId: worldTopicId || undefined }),
    loadPage: (cursor) => fetchWorldCatalogPage(realmWorldData, worldQuery, cursor, { topicId: worldTopicId || undefined }),
    enabled: bootstrapReady,
    networkOffline,
    staleTime: 30_000,
  });
  const worldCatalogQuery = worldCatalog.query;
  const worldCatalogItems = useMemo(
    () => worldCatalogQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [worldCatalogQuery.data],
  );
  const worldCatalogPaging: WorldCatalogPaging = {
    totalCount: worldCatalogQuery.data?.pages[0]?.totalCount ?? 0,
    hasMore: Boolean(worldCatalogQuery.hasNextPage),
    loadingMore: worldCatalogQuery.isFetchingNextPage,
    loadMoreFailed: worldCatalogQuery.isFetchNextPageError,
    // Offline keeps only the pages already shown for this query and marks them incomplete.
    offlineIncomplete: worldCatalog.offline && Boolean(worldCatalogQuery.data),
    onLoadMore: () => {
      void worldCatalogQuery.fetchNextPage();
    },
  };

  // Persona cards carry their own world name; the banner comes from worlds already loaded.
  const worldsMap = useMemo(
    () => new Map(worldCatalogItems.map((w) => [w.id, { bannerUrl: w.bannerUrl, name: w.name }])),
    [worldCatalogItems],
  );

  const personaQuery = useDebouncedSearch(props.searchText);
  const personaCatalog = useExploreCatalogQuery({
    queryKey: ['explore-personas', WORLD_CATALOG_CONTRACT_VERSION, realmBaseUrl, authStatus, personaQuery],
    loadPage: (cursor) => realmExploreData.loadExplorePersonas({
      query: personaQuery || undefined,
      cursor,
      limit: PAGE_SIZE,
    }),
    enabled: bootstrapReady,
    networkOffline,
  });
  const personaSourcesQuery = personaCatalog.query;
  const personaPages = personaSourcesQuery.data?.pages;
  const personaSourceBase = useMemo(
    () => parsePersonaSources({ items: personaPages?.flatMap((page) => page.items) ?? [] }, worldsMap),
    [personaPages, worldsMap],
  );
  const personaTotalCount = personaPages?.[0]?.totalCount ?? 0;

  const personaSourceDiscoveryKey = useMemo(
    () => personaSourceBase
      .map((source) => source.sourceRef ? characterSourceRefKey(source.sourceRef) : source.id)
      .join('|'),
    [personaSourceBase],
  );

  const personaSourceLocalAgentsQuery = useQuery({
    queryKey: ['explore-personas-local-agents', ownerUserId, personaSourceDiscoveryKey],
    queryFn: async () => (await Promise.all(
      personaSourceBase.map((source) => discoverCharacterSourceLocalAgents(source, ownerUserId, bindings.sdk)),
    )).flat(),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId) && personaSourceBase.length > 0,
    staleTime: 10_000,
  });

  const personaSourceRuntimeInventoryPending = Boolean(
    ownerUserId
    && personaSourceBase.length > 0
    && personaSourceLocalAgentsQuery.isPending,
  );
  const personaSourceRuntimeInventoryUnavailable = Boolean(
    personaSourceBase.length > 0
    && (!ownerUserId || personaSourceLocalAgentsQuery.isError),
  );

  const personaSources = useMemo(
    () => personaSourceBase.map((personaSource) => ({
      ...personaSource,
      materializationActionState: sourceActionStates[`${realmBaseUrl}:${ownerUserId}:${characterSourceRefKey(personaSource.sourceRef)}`],
      sourceState: resolveCharacterSourceState(
        personaSource,
        personaSourceLocalAgentsQuery.data ?? [],
        {
          runtimeInventoryPending: personaSourceRuntimeInventoryPending,
          runtimeInventoryUnavailable: personaSourceRuntimeInventoryUnavailable,
        },
      ),
    })),
    [
      personaSourceBase,
      personaSourceLocalAgentsQuery.data,
      personaSourceRuntimeInventoryPending,
      personaSourceRuntimeInventoryUnavailable,
      sourceActionStates,
      ownerUserId,
      realmBaseUrl,
    ],
  );

  // @nimi-authority: rule.nimi.desktop.product-surfaces.r006
  const onPersonaSourceManage = useCallback(async (source: ExplorePersonaSourceCardData) => {
    const scope = captureAccountActionScope(appStore);
    if (!scope) return;
    const isCurrent = () => mounted.current && scope.isCurrent();
    if (!isCurrent() || scope.accountId !== ownerUserId || scope.realmBaseUrl !== realmBaseUrl) {
      scope.dispose();
      return;
    }
    const actionKey = `${realmBaseUrl}:${ownerUserId}:${characterSourceRefKey(source.sourceRef)}`;
    if (sourceActionsInFlight.current.has(actionKey)) { scope.dispose(); return; }
    const refreshOnly = source.materializationActionState === 'refresh';
    const action = describeCharacterPrimaryAction(source.sourceState ?? 'source_materialization_unavailable', i18n.t);
    if (!refreshOnly && action.disabled) { scope.dispose(); return; }
    sourceActionsInFlight.current.add(actionKey);
    setSourceActionStates((current) => ({ ...current, [actionKey]: 'running' }));
    const clearAction = () => setSourceActionStates((current) => {
      const next = { ...current };
      delete next[actionKey];
      return next;
    });
    let partnerConfirmed = refreshOnly;
    try {
      if (!refreshOnly && action.action === 'open_partner') {
        const target = await resolveAgentTargetSnapshotForSourceRef({ sourceRef: source.sourceRef, ownerUserId, sdk: bindings.sdk, isCurrent });
        if (!isCurrent()) return;
        if (!target) throw new Error(i18n.t('Explore.characterPartnerOpenUnavailable', {
          defaultValue: 'This partner could not be opened. Refresh your partner list and select the partner again.',
        }));
        await launchAgentConversationFromDisplay({ target, navigation, setAgentConversationTargetSnapshot });
        if (isCurrent()) clearAction();
        return;
      }
      if (refreshOnly) {
        await confirmCharacterSourceMaterialized(source, ownerUserId, i18n.t, bindings.sdk, isCurrent);
      } else {
        await ensureCharacterSourceMaterialized(source, ownerUserId, i18n.t, bindings.sdk, isCurrent);
      }
      partnerConfirmed = true;
      await queryClient.invalidateQueries({ queryKey: ['explore-personas-local-agents'], exact: false }, { throwOnError: true });
      await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true }, { throwOnError: true });
      await queryClient.invalidateQueries({ queryKey: ['desktop-local-app-agent-references'], exact: false }, { throwOnError: true });
      if (!isCurrent()) return;
      clearAction();
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterPartnerReadyFeedback', { defaultValue: 'Your partner is ready. Choose Open partner when you want to chat.' }),
      });
      logRendererEvent({ level: 'info', area: 'explore', message: 'action:realm-source-materialization:partner-ready' });
    } catch (error) {
      if (!isCurrent()) return;
      const refreshPending = partnerConfirmed || error instanceof CharacterSourceConfirmationPendingError;
      if (refreshPending) setSourceActionStates((current) => ({ ...current, [actionKey]: 'refresh' }));
      else clearAction();
      setFeedback({
        kind: refreshPending ? 'warning' : 'error',
        message: refreshPending
          ? i18n.t('Explore.characterSourceRefreshPending', { defaultValue: 'Your partner was created, but the partner list could not be refreshed. Refresh the partner to confirm it without creating another one.' })
          : characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    } finally {
      sourceActionsInFlight.current.delete(actionKey);
      scope.dispose();
      if (mounted.current) setSourceActionStates((current) => {
        if (current[actionKey] !== 'running') return current;
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  }, [appStore, bindings.sdk, i18n, ownerUserId, realmBaseUrl, queryClient, navigation, setAgentConversationTargetSnapshot]);

  const onPersonaSourceOpen = useCallback(
    (sourceRef: CharacterSourceRefV3) => {
      navigation.push({ id: 'source-detail', sourceRef: sourceRef });
    },
    [navigation],
  );

  return (
    <>
      <ExploreView
        personaSources={personaSources}
        worldCatalogItems={worldFavorites ? favorites.worlds : worldCatalogItems}
        worldCatalogPaging={worldFavorites ? { totalCount: favorites.worlds.length, hasMore: false, loadingMore: false, loadMoreFailed: false, offlineIncomplete: favorites.offline && favorites.worlds.length > 0, onLoadMore() {} } : worldCatalogPaging}
        worldFavorites={worldFavorites}
        onWorldFavoritesSelect={selectWorldFavorites}
        worldFavoritesUnavailable={worldFavorites ? favorites.unavailable : undefined}
        worldFavoritesPartialError={worldFavorites && favorites.partialError}
        renderWorldPeople={renderWorldPeople}
        worldTopicShelves={<WorldAtlasTopics topics={worldTopics.data ?? []} source={worldAtlasSource} onSelect={setWorldTopicId} renderPeople={renderWorldPeople} />}
        worldTopics={worldTopics.data ?? []}
        worldTopicId={worldTopicId}
        onWorldTopicChange={setWorldTopicId}
        worldTopicsFailed={worldTopics.isError}
        onRetryWorldTopics={() => { void worldTopics.refetch(); }}
        worldSearchText={worldSearchText}
        onWorldSearchTextChange={setWorldSearchText}
        personaSearchText={props.searchText}
        personaTotalCount={personaTotalCount}
        personaHasMore={Boolean(personaSourcesQuery.hasNextPage)}
        personaLoadingMore={personaSourcesQuery.isFetchingNextPage}
        personaLoadMoreFailed={personaSourcesQuery.isFetchNextPageError}
        personaOffline={personaCatalog.offline}
        onLoadMorePersonas={() => {
          void personaSourcesQuery.fetchNextPage();
        }}
        worldsLoading={worldFavorites ? favorites.loading : worldCatalog.initialLoading}
        worldsError={worldFavorites ? favorites.error : worldCatalog.initialUnavailable}
        worldsOffline={worldFavorites ? favorites.offline : worldCatalog.offline}
        onRetryWorlds={() => {
          if (worldFavorites) { favorites.retry(); return; }
          void worldCatalogQuery.refetch();
        }}
        activeSection={props.activeSection}
        onSectionChange={props.onSectionChange}
        onSearchTextChange={props.onSearchTextChange}
        personaLoading={personaCatalog.initialLoading}
        personaError={personaCatalog.initialUnavailable}
        onRetryPersonas={() => {
          void personaSourcesQuery.refetch();
        }}
        onPersonaSourceManage={onPersonaSourceManage}
        onPersonaSourceOpen={onPersonaSourceOpen}
      />
    </>
  );
}

const SEARCH_DEBOUNCE_MS = 300;

function useDebouncedSearch(value: string): string {
  const normalized = value.trim();
  const [debounced, setDebounced] = useState(normalized);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(normalized), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalized]);
  return debounced;
}
