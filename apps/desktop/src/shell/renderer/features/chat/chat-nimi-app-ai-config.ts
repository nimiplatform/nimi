import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NimiAIConfigOverwriteInput,
  NimiAIConfigSnapshot,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export const DESKTOP_NIMI_APP_ID = 'nimi.desktop';
const TEXT_GENERATE_CAPABILITY = 'text.generate';

export function findDesktopNimiTextIntent(
  config: NimiPortableAppAIConfig | null | undefined,
): NimiPortableAppAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === TEXT_GENERATE_CAPABILITY,
  ) ?? null;
}

export async function readDesktopNimiAppAIConfig(
  reader: { readonly get: () => Promise<NimiAIConfigSnapshot> },
): Promise<NimiAIConfigSnapshot> {
  return reader.get();
}

export function desktopNimiAppAIConfigQueryKey(appId: string) {
  const exactAppId = appId.trim();
  if (!exactAppId || exactAppId !== appId) {
    throw new Error('Desktop App AIConfig requires one exact appId.');
  }
  return ['app-ai-config', exactAppId] as const;
}

/** Runtime-owned App AIConfig read-through; React Query is not persistence. */
export function useDesktopNimiAppAIConfig(appId: string) {
  const sdk = useDesktopRendererSdk();
  const queryKey = desktopNimiAppAIConfigQueryKey(appId);
  return useQuery({
    queryKey,
    queryFn: () => readDesktopNimiAppAIConfig(sdk.accountProduct().appAIConfig(appId)),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

/** Whole-object mutation through the Desktop first-party semantic client. */
export function useOverwriteDesktopNimiAppAIConfig(appId: string) {
  const sdk = useDesktopRendererSdk();
  const queryClient = useQueryClient();
  const queryKey = desktopNimiAppAIConfigQueryKey(appId);
  return useMutation({
    mutationFn: (input: NimiAIConfigOverwriteInput) => (
      sdk.accountProduct().appAIConfig(appId).overwrite(input)
    ),
    onSuccess(result) {
      queryClient.setQueryData(queryKey, {
        config: result.config,
        revision: result.revision,
        effectiveSelections: [],
      });
      // Mutation results acknowledge committed/current config but do not own
      // effective state. Refresh it for both commit and typed CAS conflict.
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
