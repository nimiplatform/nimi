import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import {
  projectModelConfigLocalSelections,
  type ModelConfigLocalSelectionProjection,
} from '@nimiplatform/kit/features/model-config/headless';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export const DESKTOP_NIMI_APP_ID = 'nimi.desktop';
export const DESKTOP_NIMI_MACHINE_LOCAL_SELECTIONS_QUERY_KEY = [
  'machine-local-ai-configuration',
  'model-config-projection',
] as const;

const TEXT_GENERATE_CAPABILITY = 'text.generate';

export function findDesktopNimiTextIntent(
  config: NimiCapabilityAIConfig | null | undefined,
): NimiCapabilityAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === TEXT_GENERATE_CAPABILITY,
  ) ?? null;
}

export async function readDesktopNimiAppAIConfig(
  reader: { readonly get: () => Promise<NimiCapabilityAIConfig> },
): Promise<NimiCapabilityAIConfig | null> {
  try {
    return await reader.get();
  } catch (error) {
    if (extractNimiErrorFields(error).reasonCode === 'AI_CONFIG_NOT_FOUND') return null;
    throw error;
  }
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
    mutationFn: (capabilities: readonly NimiCapabilityAIConfigIntent[]) => (
      sdk.accountProduct().appAIConfig(appId).overwrite(capabilities)
    ),
    onSuccess(config) {
      queryClient.setQueryData(queryKey, config);
    },
  });
}

/** Read-only projection of machine-owned local selections for Model Config UX. */
export function useDesktopNimiMachineLocalSelections() {
  const sdk = useDesktopRendererSdk();
  return useQuery<readonly ModelConfigLocalSelectionProjection[]>({
    queryKey: DESKTOP_NIMI_MACHINE_LOCAL_SELECTIONS_QUERY_KEY,
    queryFn: async () => projectModelConfigLocalSelections(
      await sdk.machineProduct().local.aiConfiguration.get(),
    ),
    retry: false,
    staleTime: 15_000,
  });
}
