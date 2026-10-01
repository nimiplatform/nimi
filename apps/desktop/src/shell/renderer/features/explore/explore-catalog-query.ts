import { useInfiniteQuery } from '@tanstack/react-query';
import { isRealmOfflineErrorLike } from '@nimiplatform/sdk/types';
import type { RealmCatalogPage } from '../world/data/realm-world-data.js';

// Catalogs keep accepted pages when a later request fails. TanStack's paused first request
// has no error and is still pending, so it needs an explicit offline projection.
export function useExploreCatalogQuery<T>(input: {
  queryKey: readonly unknown[];
  loadPage: (cursor: string | null) => Promise<RealmCatalogPage<T>>;
  enabled: boolean;
  networkOffline: boolean;
  staleTime?: number;
}) {
  const query = useInfiniteQuery({
    queryKey: input.queryKey,
    queryFn: ({ pageParam }) => input.loadPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: input.enabled,
    staleTime: input.staleTime,
    retry: false,
  });
  const offline = input.networkOffline || query.isPaused || isRealmOfflineErrorLike(query.error);
  return {
    query,
    offline,
    initialLoading: !query.data && query.isPending && !offline,
    initialUnavailable: !query.data && (query.isError || offline),
  };
}
