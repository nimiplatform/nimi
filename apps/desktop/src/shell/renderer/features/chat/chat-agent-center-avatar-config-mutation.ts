import type { QueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import {
  agentCenterLocalConfigQueryKey,
  putAgentCenterLocalConfig,
} from '@renderer/bridge/runtime-bridge/chat-agent-center-local-config-store';
import type { AgentCenterLocalConfig } from './chat-agent-center-local-config';
import type { AgentCenterAvatarConfigPatch } from './chat-agent-center-avatar-config-types';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

export function useAgentCenterAvatarConfigMutation(input: UseAgentConversationPresentationInput, queryClient: QueryClient, currentConfig: AgentCenterLocalConfig | null | undefined) {
  return useMutation({
    mutationFn: async (patch: AgentCenterAvatarConfigPatch) => {
      if (!input.accountId || !input.activeTarget?.localAgentRef || !currentConfig) {
        throw new Error(input.t('Chat.agentCenterAvatarConfigAgentRequired', {
          defaultValue: 'Select an agent before changing Avatar configuration.',
        }));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'backend_kind')) {
        throw new Error(input.t('Chat.agentCenterAvatarBackendDerivedFromLocalAsset', {
          defaultValue: 'Avatar backend kind is derived from the selected local asset. Import or select a Live2D/VRM asset to switch backend.',
        }));
      }
      const nextAvatarAsset = {
        ...currentConfig.modules.avatar_asset,
        ...patch,
        updated_at: new Date().toISOString(),
        provenance: {
          source: 'user_selection' as const,
          evidence_ref: 'agent-center-avatar-settings',
        },
      };
      if (nextAvatarAsset.backend_kind !== 'live2d') {
        nextAvatarAsset.live2d_adapter_manifest_source = 'none';
        nextAvatarAsset.live2d_adapter_manifest_ref = null;
      }
      return putAgentCenterLocalConfig({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        runtimeSourceRef: input.activeTarget.runtimeSourceRef,
        localAgentRef: input.activeTarget.localAgentRef,
        config: {
          ...currentConfig,
          modules: {
            ...currentConfig.modules,
            avatar_asset: nextAvatarAsset,
          },
        },
      });
    },
    onSuccess: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
      });
    },
  });
}
