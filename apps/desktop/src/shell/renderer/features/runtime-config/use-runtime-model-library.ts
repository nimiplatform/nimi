import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { createNimiRuntimeLocalEnvironmentClient } from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useUnobservedRuntimeRead } from './use-unobserved-runtime-read.js';

export const RUNTIME_MODEL_LIBRARY_KEY = ['runtime', 'model-library-presentation'] as const;
const ASSET_CATALOG_KEY = [...RUNTIME_MODEL_LIBRARY_KEY, 'verified'] as const;
const INSTALLED_ASSETS_KEY = [...RUNTIME_MODEL_LIBRARY_KEY, 'installed'] as const;

export function useRuntimeAssetCatalog(enabled = true) {
  const sdk = useDesktopRendererSdk();
  const query = useQuery({
    queryKey: ASSET_CATALOG_KEY,
    enabled,
    staleTime: 15_000,
    queryFn: ({ signal }) => createNimiRuntimeLocalEnvironmentClient({
      local: () => sdk.localEnvironmentRpc(), callOptions: { signal },
    }).listVerifiedAssets(),
  });
  useUnobservedRuntimeRead(ASSET_CATALOG_KEY, enabled, query.fetchStatus);
  return query;
}

export function useRuntimeInstalledAssets(enabled = true) {
  const sdk = useDesktopRendererSdk();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: INSTALLED_ASSETS_KEY,
    enabled,
    staleTime: 15_000,
    queryFn: ({ signal }) => createNimiRuntimeLocalEnvironmentClient({
      local: () => sdk.localEnvironmentRpc(), callOptions: { signal },
    }).listModelAssets(),
  });
  useUnobservedRuntimeRead(INSTALLED_ASSETS_KEY, enabled, query.fetchStatus);
  const refreshAfterMutation = useCallback(async () => {
    // A read sent before a completed mutation cannot attest its resulting assets.
    await queryClient.cancelQueries({ queryKey: INSTALLED_ASSETS_KEY, exact: true });
    await queryClient.invalidateQueries({ queryKey: INSTALLED_ASSETS_KEY, exact: true });
  }, [queryClient]);
  return { ...query, refreshAfterMutation };
}

export function useRuntimeModelLibrary(enabled = true) {
  const catalog = useRuntimeAssetCatalog(enabled);
  const assets = useRuntimeInstalledAssets(enabled);
  const data = useMemo(() => catalog.data && assets.data
    ? { catalog: catalog.data, assets: assets.data }
    : undefined, [catalog.data, assets.data]);
  const refetch = useCallback(async () => Promise.all([catalog.refetch(), assets.refetch()]), [catalog.refetch, assets.refetch]);
  return {
    data,
    isPending: catalog.isPending || assets.isPending,
    isError: catalog.isError || assets.isError,
    refetch,
  };
}
