import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export const DESKTOP_NIMI_APP_ID = 'nimi.desktop';
export const DESKTOP_NIMI_APP_AI_CONFIG_QUERY_KEY = [
  'app-ai-config',
  DESKTOP_NIMI_APP_ID,
] as const;

const TEXT_GENERATE_CAPABILITY = 'text.generate';

export function findDesktopNimiTextIntent(
  config: NimiCapabilityAIConfig | null | undefined,
): NimiCapabilityAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === TEXT_GENERATE_CAPABILITY,
  ) ?? null;
}

export function createDesktopNimiLocalTextIntent(): NimiCapabilityAIConfigIntent {
  return {
    capabilityContract: TEXT_GENERATE_CAPABILITY,
    requiredFeatures: [],
    defaults: undefined,
    route: {
      oneofKind: 'local',
      local: {},
    },
  };
}

export function replaceDesktopNimiTextIntent(
  capabilities: readonly NimiCapabilityAIConfigIntent[],
  textIntent: NimiCapabilityAIConfigIntent,
): NimiCapabilityAIConfigIntent[] {
  if (textIntent.capabilityContract !== TEXT_GENERATE_CAPABILITY) {
    throw new Error('DESKTOP_NIMI_TEXT_INTENT_REQUIRED');
  }
  const retained = capabilities.filter(
    (intent) => intent.capabilityContract !== TEXT_GENERATE_CAPABILITY,
  );
  return [textIntent, ...retained];
}

/**
 * Read-through projection of Runtime-owned App AIConfig. React Query is only
 * an in-memory renderer projection; Runtime remains the durable owner.
 */
export function useDesktopNimiAppAIConfig() {
  const sdk = useDesktopRendererSdk();
  return useQuery({
    queryKey: DESKTOP_NIMI_APP_AI_CONFIG_QUERY_KEY,
    queryFn: () => sdk.accountProduct().aiConfig.get(),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * Whole-object App AIConfig mutation. The semantic client fixes the owner to
 * `nimi.desktop`; callers submit only capability intent and never a route,
 * model, binding, readiness, or machine identity.
 */
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
