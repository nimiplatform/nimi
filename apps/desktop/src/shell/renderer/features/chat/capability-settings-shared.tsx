import { useQuery } from '@tanstack/react-query';
import { listNimiRuntimeLocalAssetEntries } from '@nimiplatform/sdk/runtime';
import type { LocalAssetEntry } from '@nimiplatform/kit/features/model-config/headless';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

export function useLocalAssets(options: { enabled?: boolean } = {}) {
  return useQuery<LocalAssetEntry[]>({
    queryKey: ['image-companion-local-assets'],
    queryFn: async () => listNimiRuntimeLocalAssetEntries(getDesktopRuntime()),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}
