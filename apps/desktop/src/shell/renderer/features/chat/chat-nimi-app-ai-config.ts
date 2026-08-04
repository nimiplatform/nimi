import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiCapabilityAIConfig,
  type NimiCapabilityAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
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

type DesktopNimiTextIntentFields = {
  readonly requiredFeatures?: readonly string[];
  readonly defaults?: NimiJsonObject;
};

export function createDesktopNimiLocalTextIntent(
  fields: DesktopNimiTextIntentFields = {},
): NimiCapabilityAIConfigIntent {
  const intent = createNimiLocalAIConfigCapabilityIntent({
    capabilityContract: TEXT_GENERATE_CAPABILITY,
    requiredFeatures: fields.requiredFeatures ?? [],
    ...(fields.defaults ? { defaults: fields.defaults } : {}),
  });
  return {
    ...intent,
    // Keep the complete canonical shape visible to consumers and tests.
    defaults: intent.defaults,
  };
}

/**
 * Switches only consumer route intent. Desktop never creates, reads, carries,
 * or interprets implementation, provider-model target, Connector, binding, or
 * readiness authority.
 */
export function createDesktopNimiCloudTextIntent(
  fields: DesktopNimiTextIntentFields = {},
): NimiCapabilityAIConfigIntent {
  const base = createDesktopNimiLocalTextIntent(fields);
  return {
    ...base,
    route: {
      oneofKind: 'cloud',
      cloud: { connectorGrantId: '' },
    },
  };
}

export function desktopNimiTextIntentDefaults(
  intent: NimiCapabilityAIConfigIntent | null | undefined,
): NimiJsonObject {
  return runtimeAIConfigStructToJson(intent?.defaults);
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

/** Runtime-owned App AIConfig read-through; React Query is not persistence. */
export function useDesktopNimiAppAIConfig() {
  const sdk = useDesktopRendererSdk();
  return useQuery({
    queryKey: DESKTOP_NIMI_APP_AI_CONFIG_QUERY_KEY,
    queryFn: () => sdk.accountProduct().aiConfig.get(),
    retry: false,
    staleTime: 30_000,
  });
}

/** Whole-object mutation through the desktop-first-party semantic client. */
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
