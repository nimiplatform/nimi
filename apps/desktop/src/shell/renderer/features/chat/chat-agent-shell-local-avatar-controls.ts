import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAgentConversationAnchorBindings } from '../../app-shell/providers/agent-conversation-anchor-binding-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { useAgentLocalAvatarLaunchControls } from './chat-agent-local-avatar-launch-controls';
export { resolveAvatarComposerActionState } from './chat-agent-local-avatar-launch-controls';

export function useAgentConversationLocalAvatarControls(input: UseAgentConversationPresentationInput) {
  const anchorBindings = useAgentConversationAnchorBindings();
  const bindings = useDesktopRendererBindings();
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
      return bindings.sdk.accountProduct().artifacts.cleanupGeneratedVoiceArtifacts({
        agentId: input.activeTarget.localAgentRef,
        conversationAnchorId: input.activeConversationAnchorId,
      });
    },
    onSuccess: async () => {
      if (input.activeTarget?.localAgentRef) {
        anchorBindings.clear(input.activeTarget.localAgentRef);
      }
    },
  });
  const presentationProfile = input.runtimeInspect?.presentationProfile || input.activeTarget?.presentationProfile || null;
  const avatarAssetRef = presentationProfile?.avatarAssetRef || null;
  const avatarConfigured = Boolean(avatarAssetRef);
  const avatarLaunchControls = useAgentLocalAvatarLaunchControls({
    presentation: input,
    avatarAssetRef,
    backendCapabilityProfileRef: null,
    avatarConfigured,
    validationStatus: null,
  });

  return useMemo(() => ({
    backdropImageUrl: null as string | null,
    voiceArtifactCleanupMutation,
    avatarComposerActionState: avatarLaunchControls.avatarComposerActionState,
    handleComposerAvatarAction: avatarLaunchControls.handleComposerAvatarAction,
    startWithChatGateResult: avatarLaunchControls.startWithChatGateResult,
  }), [
    avatarLaunchControls.avatarComposerActionState,
    avatarLaunchControls.handleComposerAvatarAction,
    avatarLaunchControls.startWithChatGateResult,
    voiceArtifactCleanupMutation,
  ]);
}
