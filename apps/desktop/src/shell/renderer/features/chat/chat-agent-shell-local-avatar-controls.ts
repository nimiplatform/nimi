import { useMemo } from 'react';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { useAgentLocalAvatarLaunchControls } from './chat-agent-local-avatar-launch-controls';
export { resolveAvatarComposerActionState } from './chat-agent-local-avatar-launch-controls';

export function useAgentConversationLocalAvatarControls(input: UseAgentConversationPresentationInput) {
  const presentationProfile = input.activeTarget?.presentationProfile || null;
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
    avatarComposerActionState: avatarLaunchControls.avatarComposerActionState,
    handleComposerAvatarAction: avatarLaunchControls.handleComposerAvatarAction,
    startWithChatGateResult: avatarLaunchControls.startWithChatGateResult,
  }), [
    avatarLaunchControls.avatarComposerActionState,
    avatarLaunchControls.handleComposerAvatarAction,
    avatarLaunchControls.startWithChatGateResult,
  ]);
}
