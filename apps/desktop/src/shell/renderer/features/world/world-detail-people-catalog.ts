import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { isRealmOfflineErrorLike } from '@nimiplatform/sdk/types';
import type { RealmCatalogPage, RealmCatalogPageRequest } from './data/realm-world-data.js';
import type { WorldCharacterSummaryDto } from './data/world-public-projection.js';
import { WORLD_CATALOG_CONTRACT_VERSION } from './world-detail-queries';
import { toWorldDisplayCharacter } from './world-detail-primary-projection.js';
import type { WorldCharacter, WorldPeopleCatalogState } from './world-detail-types';

type PeopleCatalogPage = RealmCatalogPage<WorldCharacterSummaryDto>;

export type WorldPeopleCatalogSource = {
  readonly loadWorldCharacterPage: (worldId: string, request: RealmCatalogPageRequest) => Promise<PeopleCatalogPage>;
  readonly loadPersonaCharacterCatalogPage: (
    request: RealmCatalogPageRequest & { worldId?: string },
  ) => Promise<PeopleCatalogPage>;
};

export type WorldPeopleCatalogInput = {
  readonly worldId: string;
  readonly worldCreatedAt: string;
  readonly realmBaseUrl: string;
  // The debounced server search term, and the text the reader is typing.
  readonly query: string;
  readonly queryText: string;
  readonly onQueryChange: (query: string) => void;
  readonly seededCharacterPage?: PeopleCatalogPage;
  readonly seededPersonaPage?: PeopleCatalogPage;
  readonly enabled: boolean;
  // The Desktop's own reachability signal. Realm reads are mediated by Runtime, so either one
  // being unreachable leaves the catalog offline.
  readonly networkOffline: boolean;
  readonly source: WorldPeopleCatalogSource;
};

type CatalogQuery = {
  readonly data: unknown;
  readonly isError: boolean;
  readonly isPaused: boolean;
};

// A first page with data is ready; without data it has failed, is waiting for the connection
// (TanStack pauses fetches while offline and never errors them), or is still loading.
function firstPageState(query: CatalogQuery): 'ready' | 'failed' | 'paused' | 'pending' {
  if (query.data) return 'ready';
  if (query.isError) return 'failed';
  return query.isPaused ? 'paused' : 'pending';
}

// People browsing reads the world's characters and personas from Realm catalogs: the detail's
// first bounded page seeds the unfiltered query, later pages continue by cursor, and search runs
// on the server so a loaded page is never presented as the whole population.
export function useWorldPeopleCatalog(input: WorldPeopleCatalogInput): {
  readonly peopleCharacters: WorldCharacter[];
  readonly peopleCatalog: WorldPeopleCatalogState;
} {
  const { worldId, query, source } = input;
  const characterCatalogQuery = useInfiniteQuery({
    queryKey: ['world-detail-character-catalog', WORLD_CATALOG_CONTRACT_VERSION, input.realmBaseUrl, worldId, query],
    queryFn: ({ pageParam }) => source.loadWorldCharacterPage(worldId, { q: query, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: query === '' && input.seededCharacterPage
      ? { pages: [input.seededCharacterPage], pageParams: [null] }
      : undefined,
    enabled: input.enabled,
    staleTime: 30_000,
    retry: false,
  });
  const personaCatalogQuery = useInfiniteQuery({
    queryKey: ['world-detail-persona-catalog', WORLD_CATALOG_CONTRACT_VERSION, input.realmBaseUrl, worldId, query],
    queryFn: ({ pageParam }) => source.loadPersonaCharacterCatalogPage({ worldId, q: query, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: query === '' && input.seededPersonaPage
      ? { pages: [input.seededPersonaPage], pageParams: [null] }
      : undefined,
    enabled: input.enabled,
    staleTime: 30_000,
    retry: false,
  });
  const peopleCharacters = useMemo(
    () => [
      ...(characterCatalogQuery.data?.pages.flatMap((page) => page.items) ?? []),
      ...(personaCatalogQuery.data?.pages.flatMap((page) => page.items) ?? []),
    ].map((character) => toWorldDisplayCharacter(character, input.worldCreatedAt)),
    [characterCatalogQuery.data, personaCatalogQuery.data, input.worldCreatedAt],
  );
  // A failed first page is a failure, never an empty population, and a paused one is offline,
  // never loading; a later page that fails or waits keeps the loaded pages.
  const firstPages = [firstPageState(characterCatalogQuery), firstPageState(personaCatalogQuery)];
  const queries = [characterCatalogQuery, personaCatalogQuery];
  const peopleCatalog: WorldPeopleCatalogState = {
    status: firstPages.includes('failed')
      ? 'error'
      : firstPages.includes('paused')
        ? 'offline'
        : firstPages.includes('pending') ? 'loading' : 'ready',
    offline: input.networkOffline
      || queries.some((catalogQuery) => catalogQuery.isPaused || isRealmOfflineErrorLike(catalogQuery.error)),
    totalCount: (characterCatalogQuery.data?.pages[0]?.totalCount ?? 0)
      + (personaCatalogQuery.data?.pages[0]?.totalCount ?? 0),
    hasMore: Boolean(characterCatalogQuery.hasNextPage || personaCatalogQuery.hasNextPage),
    loadingMore: characterCatalogQuery.isFetchingNextPage || personaCatalogQuery.isFetchingNextPage,
    loadMorePaused: queries.some((catalogQuery) => catalogQuery.isPaused && Boolean(catalogQuery.data)),
    loadMoreFailed: characterCatalogQuery.isFetchNextPageError || personaCatalogQuery.isFetchNextPageError,
    query: input.queryText,
    onQueryChange: input.onQueryChange,
    onLoadMore: () => {
      // World characters are paged first; personas continue after them.
      if (characterCatalogQuery.hasNextPage) {
        void characterCatalogQuery.fetchNextPage();
      } else if (personaCatalogQuery.hasNextPage) {
        void personaCatalogQuery.fetchNextPage();
      }
    },
    onRetry: () => {
      for (const catalogQuery of queries) {
        if (firstPageState(catalogQuery) === 'failed') void catalogQuery.refetch();
      }
    },
  };
  return { peopleCharacters, peopleCatalog };
}
