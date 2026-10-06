import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  runtimeAIConfigStructToJson,
  type NimiAIConfigOverwriteInput,
  type NimiAIConfigSnapshot,
  type NimiPortableAppAIConfig,
  type NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import { nimiProviderUsesChatGPTPlan } from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { ConversationSetupState } from '@nimiplatform/kit/features/chat';

export const DESKTOP_NIMI_APP_ID = 'nimi.desktop';
const TEXT_GENERATE_CAPABILITY = 'text.generate';

export function resolveDesktopNimiChatSetupState(input: {
  isPending: boolean;
  isError: boolean;
  hasTextIntent: boolean;
}): ConversationSetupState {
  if (input.isError) return { mode: 'ai', status: 'unavailable', issues: [], primaryAction: null };
  if (input.hasTextIntent) return { mode: 'ai', status: 'ready', issues: [], primaryAction: null };
  return {
    mode: 'ai',
    status: 'setup-required',
    issues: input.isPending ? [] : [{ code: 'ai-capability-intent-required', detail: null }],
    primaryAction: input.isPending ? null : {
      kind: 'open-settings', targetId: 'runtime-overview', returnToMode: 'ai',
    },
  };
}

export function findDesktopNimiTextIntent(
  config: NimiPortableAppAIConfig | null | undefined,
): NimiPortableAppAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === TEXT_GENERATE_CAPABILITY,
  ) ?? null;
}

/** Whether the committed Nimi Chat text route runs on the signed-in ChatGPT plan. */
export function desktopNimiTextIntentUsesChatGPTPlan(
  intent: NimiPortableAppAIConfigIntent | null,
): boolean {
  if (!intent || intent.route.oneofKind !== 'cloud') return false;
  const target = runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget);
  return nimiProviderUsesChatGPTPlan(typeof target.provider === 'string' ? target.provider : undefined);
}

export async function readDesktopNimiAppAIConfig(
  reader: { readonly get: () => Promise<NimiAIConfigSnapshot> },
): Promise<NimiAIConfigSnapshot> {
  return reader.get();
}

export function desktopNimiAppAIConfigQueryKey(appId: string) {
  const exactAppId = appId.trim();
  if (!exactAppId || exactAppId !== appId) {
    throw new Error('Nimi App AIConfig requires one exact appId.');
  }
  return ['app-ai-config', exactAppId] as const;
}

/** Runtime-owned App AIConfig read-through; React Query is not persistence. */
export function useDesktopNimiAppAIConfig(appId: string) {
  const sdk = useDesktopRendererSdk();
  const queryKey = desktopNimiAppAIConfigQueryKey(appId);
  return useQuery({
    queryKey,
    queryFn: () => readDesktopNimiAppAIConfig(
      appId === sdk.appId() ? sdk.appProduct().aiConfig : sdk.accountProduct().appAIConfig(appId),
    ),
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
      (appId === sdk.appId() ? sdk.appProduct().aiConfig : sdk.accountProduct().appAIConfig(appId))
        .overwrite(input)
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
