import { useQuery } from '@tanstack/react-query';
import { listNimiRuntimeLocalAssetEntries } from '@nimiplatform/sdk/runtime';
import type { LocalAssetEntry } from '@nimiplatform/kit/features/model-config/headless';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export function useLocalAssets(options: { enabled?: boolean } = {}) {
  const sdk = useDesktopRendererSdk();
  return useQuery<LocalAssetEntry[]>({
    queryKey: ['image-companion-local-assets'],
    queryFn: async () => listNimiRuntimeLocalAssetEntries(sdk.machineProduct()),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}
