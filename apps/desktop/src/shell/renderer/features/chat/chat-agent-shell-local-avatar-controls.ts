import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { createAgentCenterShellAppearanceAdapter } from '@nimiplatform/kit/features/agent-center/headless';
import { createAgentCenterShellBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { useAgentConversationAnchorBindings } from '../../app-shell/providers/agent-conversation-anchor-binding-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createRuntimeAgentPresentationProfileAdapter } from '../../infra/runtime-agent-presentation-profile';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { useAgentLocalAvatarLaunchControls } from './chat-agent-local-avatar-launch-controls';
export { resolveAvatarComposerActionState } from './chat-agent-local-avatar-launch-controls';

export function useAgentConversationLocalAvatarControls(input: UseAgentConversationPresentationInput) {
  const anchorBindings = useAgentConversationAnchorBindings();
  const bindings = useDesktopRendererBindings();
  const runtimePresentation = useMemo(() => createRuntimeAgentPresentationProfileAdapter({
    getRuntime: bindings.sdk.hostRuntimeAgent,
    getSubjectUserId: () => input.accountId ?? undefined,
    withScopes: bindings.sdk.withRuntimeProtectedScopes,
  }), [bindings, input.accountId]);
  const shell = useMemo(() => (hasElectronInvoke() ? createAgentCenterShellBridge() : null), []);
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
      avatarPreview: null,
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
