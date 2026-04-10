import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { LocalAssetEntry } from '@nimiplatform/nimi-kit/features/model-config';

export function useLocalAssets() {
  return useQuery({
    queryKey: ['image-companion-local-assets'],
    queryFn: async () => {
      const runtime = getPlatformClient().runtime;
      const response = await runtime.local.listLocalAssets({
        statusFilter: 0,
        kindFilter: 0,
        engineFilter: '',
        pageSize: 0,
        pageToken: '',
      });
      return (response.assets || []) as LocalAssetEntry[];
    },
    staleTime: 30_000,
  });
}
