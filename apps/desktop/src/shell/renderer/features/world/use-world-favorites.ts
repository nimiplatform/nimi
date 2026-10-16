import { useQueries } from '@tanstack/react-query';
import type { RealmWorldData } from './data/realm-world-data.js';
import { fetchWorldListItem, worldListItemQueryKey } from './world-detail-queries.js';
import { useFollowedWorlds } from './world-follow-store-context.js';

// Resolve saved IDs independently of the public catalog's pagination and filters.
export function useWorldFavorites(input: {
  data: RealmWorldData; realmBaseUrl: string; enabled: boolean; offline: boolean; search: string;
}) {
  const followed = useFollowedWorlds();
  const queries = useQueries({
    queries: followed.ids.map((worldId) => ({
      queryKey: worldListItemQueryKey(input.realmBaseUrl, worldId),
      queryFn: () => fetchWorldListItem(input.data, worldId),
      enabled: input.enabled && followed.available && !followed.error && !input.offline,
      staleTime: 30_000,
      retry: false,
    })),
  });
  const search = input.search.trim().toLocaleLowerCase();
  const loaded = queries.flatMap((query) => query.data ? [query.data] : []);
  const worlds = loaded.filter((world) => !search
    || `${world.name}\n${world.description ?? ''}`.toLocaleLowerCase().includes(search));
  const offline = input.offline || queries.some((query) => query.isPaused);
  const loading = !offline && queries.some((query) => query.isPending);
  const incomplete = !loading && queries.some((query) => !query.data);
  return {
    worlds,
    loading: followed.available && !followed.error && loading,
    unavailable: !followed.available ? 'World.favorites.signIn' : followed.error ? 'World.favorites.readError' : undefined,
    error: incomplete && loaded.length === 0,
    partialError: incomplete && loaded.length > 0,
    offline,
    retry: () => { for (const query of queries) void query.refetch(); },
  };
}
