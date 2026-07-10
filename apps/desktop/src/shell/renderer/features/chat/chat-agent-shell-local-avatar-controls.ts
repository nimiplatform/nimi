import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { createAgentCenterShellAppearanceAdapter } from '@nimiplatform/kit/features/agent-center/headless';
import { createAgentCenterShellBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { clearAgentConversationAnchorBinding } from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';
import { createRuntimeAgentPresentationProfileAdapter } from '@renderer/infra/runtime-agent-presentation-profile';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { useAgentLocalAvatarLaunchControls } from './chat-agent-local-avatar-launch-controls';
export { resolveAvatarComposerActionState } from './chat-agent-local-avatar-launch-controls';

export function useAgentConversationLocalAvatarControls(input: UseAgentConversationPresentationInput) {
  const runtimePresentation = useMemo(() => createRuntimeAgentPresentationProfileAdapter(), []);
  const shell = useMemo(() => (hasTauriInvoke() ? createAgentCenterShellBridge() : null), []);
  const appearanceAdapter = useMemo(() => {
    if (!input.activeTarget || !input.accountId) {
      return null;
    }
    return createAgentCenterShellAppearanceAdapter({
      identity: {
        ownerUserId: input.activeTarget.ownerUserId,
        runtimeSourceRef: input.activeTarget.runtimeSourceRef,
        localAgentRef: input.activeTarget.localAgentRef,
      },
      accountId: input.accountId,
      runtimePresentation,
      shell,
      snapshot: {
        inspect: input.runtimeInspect as never,
      },
    });
  }, [input.accountId, input.activeTarget, input.runtimeInspect, runtimePresentation, shell]);
  const voiceArtifactCleanupMutation = useMutation({
    mutationFn: async () => {
      if (!input.activeTarget?.localAgentRef) {
        throw new Error(input.t('Chat.agentCenterVoiceCleanupAgentRequired', {
          defaultValue: 'Select an agent before clearing generated voice.',
        }));
      }
      if (!input.activeConversationAnchorId) {
        throw new Error(input.t('Chat.agentCenterVoiceCleanupConversationRequired', {
          defaultValue: 'Open a conversation before clearing generated voice.',
        }));
      }
      return getDesktopRuntime().artifacts.cleanupGeneratedVoiceArtifacts({
        agentId: input.activeTarget.localAgentRef,
        conversationAnchorId: input.activeConversationAnchorId,
      });
    },
    onSuccess: async () => {
      if (input.activeTarget?.localAgentRef) {
        clearAgentConversationAnchorBinding(input.activeTarget.localAgentRef);
      }
    },
  });
  const presentationProfile = input.runtimeInspect?.presentationProfile || input.activeTarget?.presentationProfile || null;
  const avatarAssetRef = presentationProfile?.avatarAssetRef || null;
  const avatarConfigured = Boolean(avatarAssetRef);
  const avatarAssetValid = Boolean(avatarAssetRef);
  const avatarLaunchControls = useAgentLocalAvatarLaunchControls({
    presentation: input,
    avatarAssetRef,
    backendCapabilityProfileRef: null,
    avatarConfigured,
    avatarAssetValid,
    validationStatus: avatarConfigured ? 'valid' : null,
  });

  return useMemo(() => ({
    appearanceAdapter,
    backdropImageUrl: null as string | null,
    voiceArtifactCleanupMutation,
    avatarComposerActionState: avatarLaunchControls.avatarComposerActionState,
    handleComposerAvatarAction: avatarLaunchControls.handleComposerAvatarAction,
    startWithChatGateResult: avatarLaunchControls.startWithChatGateResult,
  }), [
    appearanceAdapter,
    avatarLaunchControls.avatarComposerActionState,
    avatarLaunchControls.handleComposerAvatarAction,
    avatarLaunchControls.startWithChatGateResult,
    voiceArtifactCleanupMutation,
  ]);
}
