import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import type { NimiMachineLoadouts } from '@nimiplatform/sdk/runtime';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import type { ModelConfigLocalSelectionProjection } from '@nimiplatform/kit/features/model-config/headless';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export const DESKTOP_NIMI_APP_ID = 'nimi.desktop';
export const DESKTOP_NIMI_MACHINE_LOCAL_SELECTIONS_QUERY_KEY = [
  'machine-loadouts',
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
// @nimi-authority: rule.nimi.runtime.local-compute.r107
export function projectDesktopMachineLoadoutSelections(
  aggregate: NimiMachineLoadouts,
): readonly ModelConfigLocalSelectionProjection[] {
  return aggregate.selections.map((selection) => {
    const loadout = aggregate.loadouts.find((candidate) => candidate.loadoutId === selection.loadoutId);
    if (!loadout || loadout.capabilityContract !== selection.capabilityContract) {
      return {
        capabilityContract: selection.capabilityContract, state: 'broken' as const,
        loadoutId: null, displayName: null, supportedFeatures: [],
        reasons: ['selected-loadout-not-found'], effectiveDefaults: null,
      };
    }
    const defaults = Object.fromEntries(Object.entries(selection.effectiveDefaults ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0,
    ));
    const reasons = loadout.validationState === 'configured'
      ? [...loadout.reasons]
      : ['loadout-unresolved', ...loadout.reasons];
    return {
      capabilityContract: selection.capabilityContract,
      state: reasons.length === 0 ? 'selected' as const : 'broken' as const,
      loadoutId: null,
      displayName: loadout.displayName || null,
      supportedFeatures: loadout.supportedFeatures,
      reasons,
      effectiveDefaults: Object.keys(defaults).length > 0 ? defaults : null,
    };
  });
}

export function useDesktopNimiMachineLocalSelections() {
  const sdk = useDesktopRendererSdk();
  return useQuery<readonly ModelConfigLocalSelectionProjection[]>({
    queryKey: DESKTOP_NIMI_MACHINE_LOCAL_SELECTIONS_QUERY_KEY,
    queryFn: async () => projectDesktopMachineLoadoutSelections(
      await sdk.machineProduct().local.loadouts.get(),
    ),
    retry: false,
    staleTime: 15_000,
  });
}
