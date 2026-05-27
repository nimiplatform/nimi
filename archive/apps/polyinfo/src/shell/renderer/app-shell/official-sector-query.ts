import type { FrontendCategoryGroup } from '@renderer/data/types.js';
import {
  fetchFrontendRootCategories,
  fetchFrontendSectorCatalog,
  fetchFrontendSubcategories,
} from '@renderer/data/frontend-taxonomy.js';

export const OFFICIAL_SECTOR_CATALOG_QUERY_KEY = ['polyinfo', 'official-sector-catalog'] as const;
export const OFFICIAL_ROOT_SECTORS_QUERY_KEY = ['polyinfo', 'official-root-sectors'] as const;

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

export function getOfficialRootSectorsQueryOptions() {
  return {
    queryKey: OFFICIAL_ROOT_SECTORS_QUERY_KEY,
    queryFn: () => fetchFrontendRootCategories(),
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  } as const;
}

export function getOfficialSubsectorsQueryOptions(root: FrontendCategoryGroup) {
  return {
    queryKey: ['polyinfo', 'official-subsectors', root.slug] as const,
    queryFn: () => fetchFrontendSubcategories(root),
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  } as const;
}
