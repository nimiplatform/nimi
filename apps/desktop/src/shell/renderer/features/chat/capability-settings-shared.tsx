import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { listRuntimeLocalAssetEntries } from '@nimiplatform/sdk/runtime';
import type { LocalAssetEntry } from '@nimiplatform/kit/features/model-config/headless';

export function useLocalAssets() {
  return useQuery({
    queryKey: ['image-companion-local-assets'],
    queryFn: async () => {
      const assets = await listRuntimeLocalAssetEntries(getPlatformClient().runtime);
      return assets as LocalAssetEntry[];
    },
    staleTime: 30_000,
  });
}
