import { useQuery } from '@tanstack/react-query';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';

export const RUNTIME_MODEL_LIBRARY_KEY = ['runtime', 'model-library-presentation'] as const;
export function useRuntimeModelLibrary() {
  const local = useRuntimeConfigLocalEnvironmentClient();
  return useQuery({
    queryKey: RUNTIME_MODEL_LIBRARY_KEY,
    staleTime: 15_000,
    queryFn: async () => {
      const [catalog, assets] = await Promise.all([local.listVerifiedAssets(), local.listModelAssets()]);
      return { catalog, assets };
    },
  });
}
