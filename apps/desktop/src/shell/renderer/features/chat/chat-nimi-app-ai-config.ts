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
export const DESKTOP_NIMI_APP_AI_CONFIG_QUERY_KEY = [
  'app-ai-config',
  DESKTOP_NIMI_APP_ID,
] as const;
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

/** Runtime-owned App AIConfig read-through; React Query is not persistence. */
export function useDesktopNimiAppAIConfig() {
  const sdk = useDesktopRendererSdk();
  return useQuery({
    queryKey: DESKTOP_NIMI_APP_AI_CONFIG_QUERY_KEY,
    queryFn: () => readDesktopNimiAppAIConfig(sdk.accountProduct().aiConfig),
    retry: false,
    staleTime: 30_000,
  });
}

/** Whole-object mutation through the Desktop first-party semantic client. */
export function useOverwriteDesktopNimiAppAIConfig() {
  const sdk = useDesktopRendererSdk();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (capabilities: readonly NimiCapabilityAIConfigIntent[]) => (
      sdk.accountProduct().aiConfig.overwrite(capabilities)
    ),
    onSuccess(config) {
      queryClient.setQueryData(DESKTOP_NIMI_APP_AI_CONFIG_QUERY_KEY, config);
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
