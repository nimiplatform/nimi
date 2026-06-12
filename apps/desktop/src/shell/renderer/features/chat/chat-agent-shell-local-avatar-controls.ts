import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  agentCenterLocalConfigQueryKey,
  getAgentCenterBackgroundAsset,
  getAgentCenterLocalConfig,
  importAgentCenterBackground,
  pickAgentCenterBackgroundSource,
  removeAgentCenterBackground,
} from '@renderer/bridge/runtime-bridge/chat-agent-center-local-config-store';
import type { AgentCenterAvatarAssetKind } from './chat-agent-center-avatar-config-types';
import { useAgentCenterAvatarConfigMutation } from './chat-agent-center-avatar-config-mutation';
import {
  buildAvatarAssetValidationPresentation,
  type DecommissionedAvatarAssetLibraryResult,
} from './chat-agent-shell-avatar-asset-diagnostics';
import { assetUrlFromFileUrl } from './chat-agent-shell-presentation-status';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { useAgentLocalAvatarLaunchControls } from './chat-agent-local-avatar-launch-controls';
export { resolveAvatarComposerActionState } from './chat-agent-local-avatar-launch-controls';

export function useAgentConversationLocalAvatarControls(input: UseAgentConversationPresentationInput) {
  const queryClient = useQueryClient();
  const avatarCarrierDecommissionedMessage = input.t('Chat.agentCenterAvatarCarrierDecommissioned', {
    defaultValue: 'Desktop-local Live2D/VRM carrier assets are decommissioned. Launch the Avatar-owned carrier instead.',
  });
  const agentCenterLocalConfigQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.localAgentRef
      ? agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef)
      : ['agent-center-local-config', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.localAgentRef
        ? getAgentCenterLocalConfig({
          accountId: input.accountId,
          ownerUserId: input.activeTarget.ownerUserId,
          realmAgentId: input.activeTarget.realmAgentId,
          localAgentRef: input.activeTarget.localAgentRef,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.localAgentRef),
    staleTime: 30_000,
  });
  const avatarAssetConfig = agentCenterLocalConfigQuery.data?.modules.avatar_asset || null;
  const selectedBackgroundAssetId = agentCenterLocalConfigQuery.data?.modules.appearance.background_asset_id || null;
  const backgroundAssetQuery = useQuery({
    queryKey: input.accountId && input.activeTarget?.localAgentRef && selectedBackgroundAssetId
      ? [
        'agent-center-background-asset',
        input.accountId,
        input.activeTarget.localAgentRef,
        selectedBackgroundAssetId,
      ]
      : ['agent-center-background-asset', 'none'],
    queryFn: async () => (
      input.accountId && input.activeTarget?.localAgentRef && selectedBackgroundAssetId
        ? getAgentCenterBackgroundAsset({
          accountId: input.accountId,
          ownerUserId: input.activeTarget.ownerUserId,
          realmAgentId: input.activeTarget.realmAgentId,
          localAgentRef: input.activeTarget.localAgentRef,
          backgroundAssetId: selectedBackgroundAssetId,
        })
        : null
    ),
    enabled: hasTauriInvoke() && Boolean(input.accountId && input.activeTarget?.localAgentRef && selectedBackgroundAssetId),
    staleTime: 30_000,
  });
  const backdropImageUrl = assetUrlFromFileUrl(backgroundAssetQuery.data?.file_url);
  const avatarConfigured = Boolean(avatarAssetConfig?.local_avatar_asset_ref);
  const avatarAssetValidation = null;
  const avatarAssetValid = false;
  const avatarAssetChecking = false;
  const avatarAssetValidationPresentation = buildAvatarAssetValidationPresentation({
    config: avatarAssetConfig,
    validation: avatarAssetValidation,
    configured: avatarConfigured,
    valid: avatarAssetValid,
    checking: avatarAssetChecking,
  });
  const avatarAssetLibraryQuery = useQuery<DecommissionedAvatarAssetLibraryResult>({
    queryKey: ['agent-center-avatar-asset-library', 'decommissioned'],
    queryFn: async () => ({ selected_local_asset_id: null, assets: [] }),
    enabled: true,
    staleTime: 15_000,
  });
  const avatarConfigMutation = useAgentCenterAvatarConfigMutation(input, queryClient, agentCenterLocalConfigQuery.data);
  const avatarAssetSelectMutation = useMutation({
    mutationFn: async (_localAssetId: string) => {
      throw new Error(avatarCarrierDecommissionedMessage);
    },
  });
  const avatarAssetImportMutation = useMutation({
    mutationFn: async (_kind: AgentCenterAvatarAssetKind) => {
      throw new Error(avatarCarrierDecommissionedMessage);
    },
  });
  const live2dAdapterManifestImportMutation = useMutation({
    mutationFn: async () => {
      throw new Error(avatarCarrierDecommissionedMessage);
    },
  });
  const clearAvatarAssetMutation = useMutation({
    mutationFn: async () => {
      throw new Error(avatarCarrierDecommissionedMessage);
    },
  });
  const avatarImportDisabled = true;
  const avatarImportError = avatarAssetImportMutation.error instanceof Error
    ? avatarAssetImportMutation.error.message
    : live2dAdapterManifestImportMutation.error instanceof Error
      ? live2dAdapterManifestImportMutation.error.message
      : avatarAssetSelectMutation.error instanceof Error
        ? avatarAssetSelectMutation.error.message
      : clearAvatarAssetMutation.error instanceof Error
        ? clearAvatarAssetMutation.error.message
        : null;
  const backgroundValidation = backgroundAssetQuery.data?.validation || null;
  const backgroundValid = backgroundValidation?.status === 'valid';
  const backgroundImportMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef) {
        throw new Error(input.t('Chat.agentCenterBackgroundImportAgentRequired', {
          defaultValue: 'Select an agent before importing a background.',
        }));
      }
      const sourcePath = await pickAgentCenterBackgroundSource();
      if (!sourcePath) {
        return null;
      }
      return importAgentCenterBackground({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        sourcePath,
        select: true,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-background-asset'] }),
      ]);
    },
  });
  const backgroundImportDisabled = !hasTauriInvoke()
    || !input.accountId
    || !input.activeTarget?.localAgentRef
    || backgroundImportMutation.isPending;
  const backgroundImportError = backgroundImportMutation.error instanceof Error
    ? backgroundImportMutation.error.message
    : null;
  const clearBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!input.accountId || !input.activeTarget?.localAgentRef || !selectedBackgroundAssetId) {
        return null;
      }
      return removeAgentCenterBackground({
        accountId: input.accountId,
        ownerUserId: input.activeTarget.ownerUserId,
        realmAgentId: input.activeTarget.realmAgentId,
        localAgentRef: input.activeTarget.localAgentRef,
        backgroundAssetId: selectedBackgroundAssetId,
      });
    },
    onSuccess: async (result) => {
      if (!result || !input.accountId || !input.activeTarget?.localAgentRef) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentCenterLocalConfigQueryKey(input.accountId, input.activeTarget.localAgentRef),
        }),
        queryClient.invalidateQueries({ queryKey: ['agent-center-background-asset'] }),
      ]);
    },
  });
  const avatarLaunchControls = useAgentLocalAvatarLaunchControls({
    presentation: input,
    avatarAssetConfig,
    avatarAssetValidation,
    avatarConfigured,
    avatarAssetValid,
  });

  return useMemo(() => ({
    backdropImageUrl,
    avatarAssetValid,
    backgroundValid,
    avatarAssetChecking,
    avatarAssetConfig,
    avatarAssetValidationPresentation,
    avatarConfigMutation,
    avatarAssetLibraryQuery,
    avatarAssetSelectMutation,
    avatarAssetImportMutation,
    avatarImportDisabled,
    avatarImportError,
    clearAvatarAssetMutation,
    live2dAdapterManifestImportMutation,
    selectedBackgroundAssetId,
    backgroundAssetQuery,
    backgroundValidation,
    backgroundImportError,
    clearBackgroundMutation,
    backgroundImportDisabled,
    backgroundImportMutation,
    avatarComposerActionState: avatarLaunchControls.avatarComposerActionState,
    handleComposerAvatarAction: avatarLaunchControls.handleComposerAvatarAction,
    startWithChatGateResult: avatarLaunchControls.startWithChatGateResult,
  }), [
    backdropImageUrl,
    avatarAssetValid,
    backgroundValid,
    avatarAssetChecking,
    avatarAssetConfig,
    avatarAssetValidationPresentation,
    avatarConfigMutation,
    avatarAssetLibraryQuery,
    avatarAssetSelectMutation,
    avatarAssetImportMutation,
    avatarImportDisabled,
    avatarImportError,
    clearAvatarAssetMutation,
    live2dAdapterManifestImportMutation,
    selectedBackgroundAssetId,
    backgroundAssetQuery,
    backgroundValidation,
    backgroundImportError,
    clearBackgroundMutation,
    backgroundImportDisabled,
    backgroundImportMutation,
    avatarLaunchControls.avatarComposerActionState,
    avatarLaunchControls.handleComposerAvatarAction,
    avatarLaunchControls.startWithChatGateResult,
  ]);
}
