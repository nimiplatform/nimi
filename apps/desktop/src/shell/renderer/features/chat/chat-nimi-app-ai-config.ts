import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NimiAIConfigOverwriteInput,
  NimiAIConfigSnapshot,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import type { ModelConfigLocalSelectionProjection } from '@nimiplatform/kit/features/model-config/headless';
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
    staleTime: 30_000,
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
      if (result.outcome === 'committed') {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function projectDesktopAIConfigEffectiveSelections(
  snapshot: NimiAIConfigSnapshot | undefined,
): readonly ModelConfigLocalSelectionProjection[] {
  if (!snapshot) return [];
  return snapshot.effectiveSelections.map((selection) => {
    const local = selection.resource?.oneofKind === 'local' ? selection.resource.local : null;
    const intent = snapshot.config?.capabilities.find((entry) => (
      entry.capabilityContract === selection.capabilityContract && entry.route.oneofKind === 'local'
    ));
    return {
      capabilityContract: selection.capabilityContract,
      state: selection.state === 'ready'
        ? 'selected' as const
        : selection.state === 'missing'
          ? 'missing' as const
          : selection.state === 'blocked'
            ? 'broken' as const
            : 'unavailable' as const,
      loadoutId: local?.loadoutRef
        || (intent?.route.oneofKind === 'local' ? intent.route.local.loadoutRef : null),
      displayName: local?.label || null,
      supportedFeatures: local?.supportedFeatures || [],
      reasons: selection.reasons,
      effectiveDefaults: null,
    };
  });
}
