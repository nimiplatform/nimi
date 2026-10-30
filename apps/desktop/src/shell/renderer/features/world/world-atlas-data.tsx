import { useQueries } from '@tanstack/react-query';
import type { RealmWorldData } from './data/realm-world-data.js';
import { fetchWorldListItem, worldListItemQueryKey } from './world-detail-queries.js';
import { WORLD_ATLAS_LEAD_WORLD_IDS } from './world-list-catalog-model.js';

export type WorldAtlasSource = { data: RealmWorldData; realmBaseUrl: string; enabled: boolean; offline: boolean };

// Spotlight entries must be available before their catalog page is loaded.
export function useWorldAtlasLeadWorlds(source: WorldAtlasSource) {
  const queries = useQueries({ queries: WORLD_ATLAS_LEAD_WORLD_IDS.map((worldId) => ({
    queryKey: worldListItemQueryKey(source.realmBaseUrl, worldId),
    queryFn: () => fetchWorldListItem(source.data, worldId),
    enabled: source.enabled && !source.offline,
    staleTime: 60_000,
    retry: false,
  })) });
  const loading = source.enabled && !source.offline && queries.some((query) => query.isPending && !query.isPaused);
  return {
    worlds: queries.flatMap((query) => query.data ? [query.data] : []),
    loading,
    error: source.enabled && !loading && queries.some((query) => !query.data),
    retry: () => { for (const query of queries) void query.refetch(); },
  };
}
