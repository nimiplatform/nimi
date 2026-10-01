import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useExploreCatalogQuery } from './explore-catalog-query.js';
import { createRealmExploreData } from './data/realm-explore-data';
import { createRealmWorldData } from '../world/data/realm-world-data.js';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { ProfileDetailModal } from '../relationship/profile-detail-modal.js';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { ExploreView } from './explore-view';
import type { ExplorePersonaSourceCardData } from './explore-cards';
import type { ExploreSectionId } from './explore-section-nav';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import { parsePersonaSources } from './explore-persona-source-projection';
import {
  WORLD_CATALOG_CONTRACT_VERSION,
  fetchWorldCatalogPage,
  worldCatalogQueryKey,
} from '../world/world-detail-queries.js';
import type { WorldCatalogPaging } from '../world/world-list';
import {
  characterSourceMaterializationFailureMessage,
  characterSourceRefKey,
  discoverCharacterSourceLocalAgents,
  resolveCharacterSourceState,
} from './character-source-materialization';
import { ensureCharacterSourceMaterialized } from '../relationship/character-source-launch-target.js';
import { resolveAgentTargetSnapshotForSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { localAgentListQueryKey } from '../agents/local-agent-list-model';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type PostDto = RealmModel<'PostDto'>;

const PAGE_SIZE = 20;
const DEFAULT_CATEGORIES = ['Research', 'Coding', 'Writing', 'Analysis', 'Creative', 'Education', 'Health & Finance'];

function toRecord(value: unknown): JsonObject | null {
  return parseOptionalJsonObject(value) ?? null;
}

type ExplorePanelProps = {
  activeSection: ExploreSectionId;
  searchText: string;
  onSectionChange: (section: ExploreSectionId) => void;
  onSearchTextChange: (value: string) => void;
};

// @nimi-authority: definition.nimi.desktop.product-surfaces.explore
// @nimi-authority: rule.nimi.desktop.product-surfaces.r001
export function ExplorePanel(props: ExplorePanelProps) {
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
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const setAgentConversationSelection = useAppStore((state) => state.setAgentConversationSelection);
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProfileTarget, setSelectedProfileTarget] = useState<
    Extract<PostCardAuthorProfileTarget, { kind: 'human' }> | null
  >(null);
  const setFeedback = emitFeedbackToast;

  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const networkOffline = useAppStore((state) => state.offlineTier !== 'L0');
  const realmWorldData = useMemo(() => createRealmWorldData(bindings.sdk), [bindings.sdk]);

  // The world rail owns its own search; worlds and personas never share one query string.
  const [worldSearchText, setWorldSearchText] = useState('');
  const worldQuery = useDebouncedSearch(worldSearchText);
  const worldCatalog = useExploreCatalogQuery({
    queryKey: worldCatalogQueryKey(realmBaseUrl, worldQuery),
    loadPage: (cursor) => fetchWorldCatalogPage(realmWorldData, worldQuery, cursor),
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
    ],
  );

  const categories = useMemo(() => {
    const dynamicTags = new Set<string>();
    for (const personaSource of personaSources) {
      for (const tag of personaSource.tags) {
        const normalized = tag.trim();
        if (normalized) {
          dynamicTags.add(normalized);
        }
      }
    }
    const combined = [...DEFAULT_CATEGORIES, ...Array.from(dynamicTags)];
    return Array.from(new Set(combined)).slice(0, 16);
  }, [personaSources]);

  // fetchPostPage for PostFeed --PostFeed manages its own pagination internally
  const fetchPostPage = useCallback(
    async (cursor: string | null) => {
      const tag = selectedCategory || undefined;
      const result = cursor
        ? await realmExploreData.loadMoreExploreFeed(PAGE_SIZE, cursor, tag)
        : await realmExploreData.loadExploreFeed(tag ?? null, PAGE_SIZE);
      const payload = toRecord(result);
      const items = Array.isArray(payload?.items) ? (payload.items as PostDto[]) : [];
      const page = toRecord(payload?.page);
      const nextCursor =
        typeof page?.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
      return { items, nextCursor };
    },
    [selectedCategory],
  );

  // Reset PostFeed when category changes or refresh is triggered
  const [refreshKey, setRefreshKey] = useState(0);
  const postFeedKey = `explore-${selectedCategory ?? 'all'}-${refreshKey}`;

  const onPersonaSourceManage = useCallback(async (source: ExplorePersonaSourceCardData) => {
    const auth = appStore.getState().auth;
    const isCurrent = () => mounted.current && auth.status === 'authenticated' && appStore.getState().auth === auth;
    if (!isCurrent()) return;
    try {
      await ensureCharacterSourceMaterialized(source, ownerUserId, i18n.t, bindings.sdk, isCurrent);
      await queryClient.invalidateQueries({ queryKey: ['explore-personas-local-agents'], exact: false });
      await queryClient.invalidateQueries({ queryKey: localAgentListQueryKey(ownerUserId), exact: true });
      await queryClient.invalidateQueries({ queryKey: ['desktop-local-app-agent-references'], exact: false });
      if (!isCurrent()) return;
      // Open the partner's own conversation; the list is only the fallback.
      const target = source.sourceRef
        ? await resolveAgentTargetSnapshotForSourceRef({ sourceRef: source.sourceRef, ownerUserId, sdk: bindings.sdk, isCurrent }).catch(() => null)
        : null;
      if (!isCurrent()) return;
      if (target) {
        await launchAgentConversationFromDisplay({
          target,
          setActiveTab,
          setChatMode,
          setSelectedTargetForSource,
          setAgentConversationSelection,
          setAgentConversationTargetSnapshot,
        });
        logRendererEvent({ level: 'info', area: 'explore', message: 'action:realm-source-materialization:partner-ready' });
        return;
      }
      setSelectedTargetForSource('agent', null);
      setChatMode('agent');
      setActiveTab('chat');
      if (!isCurrent()) return;
      setFeedback({
        kind: 'success',
        message: i18n.t('Explore.characterSourceMaterializedFeedback', {
          defaultValue: 'Your partner is ready. Select it from the chat list.',
        }),
      });
      logRendererEvent({
        level: 'info',
        area: 'explore',
        message: 'action:realm-source-materialization:partner-ready',
      });
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({
        kind: 'error',
        message: characterSourceMaterializationFailureMessage(error, i18n.t),
      });
    }
  }, [
    bindings,
    ownerUserId,
    queryClient,
    setActiveTab,
    setAgentConversationSelection,
    setAgentConversationTargetSnapshot,
    setChatMode,
    setSelectedTargetForSource,
  ]);

  const onToggleCategory = useCallback(
    (category: string) => {
      if (category === '') {
        setSelectedCategory(null);
      } else {
        setSelectedCategory((current) => (current === category ? null : category));
      }
    },
    [],
  );

  const onPostAuthorOpen = useCallback(
    (target: PostCardAuthorProfileTarget) => {
      if (target.kind === 'character') {
        navigateToSourceDetail(target.sourceRef);
        return;
      }
      setSelectedProfileTarget(target);
    },
    [navigateToSourceDetail],
  );

  const onPersonaSourceOpen = useCallback(
    (sourceRef: CharacterSourceRefV3) => {
      navigateToSourceDetail(sourceRef);
    },
    [navigateToSourceDetail],
  );

  return (
    <>
      <ExploreView
        selectedCategory={selectedCategory}
        categories={categories}
        personaSources={personaSources}
        worldCatalogItems={worldCatalogItems}
        worldCatalogPaging={worldCatalogPaging}
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
        worldsLoading={worldCatalog.initialLoading}
        worldsError={worldCatalog.initialUnavailable}
        worldsOffline={worldCatalog.offline}
        onRetryWorlds={() => {
          void worldCatalogQuery.refetch();
        }}
        activeSection={props.activeSection}
        onSectionChange={props.onSectionChange}
        onSearchTextChange={props.onSearchTextChange}
        fetchPostPage={fetchPostPage}
        postFeedKey={postFeedKey}
        onPostDelete={() => setRefreshKey((k) => k + 1)}
        personaLoading={personaCatalog.initialLoading}
        personaError={personaCatalog.initialUnavailable}
        onRetryPersonas={() => {
          void personaSourcesQuery.refetch();
        }}
        onToggleCategory={onToggleCategory}
        onPersonaSourceManage={onPersonaSourceManage}
        onPersonaSourceOpen={onPersonaSourceOpen}
        onPostAuthorOpen={onPostAuthorOpen}
      />
      <ProfileDetailModal
        open={Boolean(selectedProfileTarget)}
        profileId={selectedProfileTarget?.profileId || ''}
        profileSeed={selectedProfileTarget?.profileSeed || null}
        onClose={() => setSelectedProfileTarget(null)}
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
