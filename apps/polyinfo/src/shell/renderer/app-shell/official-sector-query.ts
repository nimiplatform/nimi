import { fetchFrontendSectorCatalog } from '@renderer/data/frontend-taxonomy.js';

export const OFFICIAL_SECTOR_CATALOG_QUERY_KEY = ['polyinfo', 'official-sector-catalog'] as const;

export function getOfficialSectorCatalogQueryOptions() {
  return {
    queryKey: OFFICIAL_SECTOR_CATALOG_QUERY_KEY,
    queryFn: () => fetchFrontendSectorCatalog(),
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  } as const;
}
