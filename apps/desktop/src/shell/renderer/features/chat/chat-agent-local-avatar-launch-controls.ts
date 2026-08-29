import { useCallback, useMemo, useState } from 'react';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { buildDesktopAvatarInstanceId } from '../../bridge/runtime-bridge/chat-agent-avatar-launcher.js';

type AvatarComposerActionState =
  | 'pending'
  | 'unavailable'
  | 'not_configured'
  | 'ready_stopped';

export function resolveAvatarComposerActionState(input: {
  avatarActionPending: boolean;
  avatarHandoffReady: boolean;
  avatarRuntimeAccountReady: boolean;
  avatarConfigured: boolean;
}): AvatarComposerActionState {
  return input.avatarActionPending
    ? 'pending'
    : !input.avatarHandoffReady || !input.avatarRuntimeAccountReady
      ? 'unavailable'
      : !input.avatarConfigured
        ? 'not_configured'
        : 'ready_stopped';
}

/**
 * Caller-scoped targeted launch-or-focus for the Agent already selected in Chat.
 *
 * The caller does not inspect or close Host instances. Repeating the same public
 * launch operation is intentionally idempotent: the Host creates the presence
 * when absent and shows/focuses the existing presence when it is hidden.
 */
export function useAgentLocalAvatarLaunchControls(input: {
  presentation: UseAgentConversationPresentationInput;
  avatarConfigured: boolean;
}) {
  const bindings = useDesktopRendererBindings();
  const presentation = input.presentation;
  const selectedAgentHandle = String(presentation.activeTarget?.agentHandle || '').trim();
  const avatarHandoffReady = bindings.app.commands.avatarHandoff.available();
  const avatarRuntimeAccountReady = Boolean(presentation.accountId);
  const [avatarActionPending, setAvatarActionPending] = useState(false);
  const avatarInstanceId = useMemo(() => (
    selectedAgentHandle
      ? buildDesktopAvatarInstanceId({ agentHandle: selectedAgentHandle })
      : null
  ), [selectedAgentHandle]);

  const handleComposerAvatarAction = useCallback(async () => {
    if (!presentation.activeTarget || !avatarInstanceId) {
      presentation.onOpenAgentCenter?.();
      return null;
    }
    if (!avatarHandoffReady) {
      return {
        kind: 'warning' as const,
        message: presentation.t('Chat.agentCenterAvatarStartRuntimeUnavailable', {
          defaultValue: 'Avatar launch requires the desktop Runtime bridge.',
        }),
      };
    }
    if (!avatarRuntimeAccountReady) {
      return {
        kind: 'warning' as const,
        message: presentation.t('Chat.agentCenterAvatarStartAccountRequired', {
          defaultValue: 'Sign in with the Runtime-backed desktop account before opening Avatar.',
        }),
      };
    }
    if (!input.avatarConfigured) {
      presentation.onOpenAgentCenter?.();
      return null;
    }
    setAvatarActionPending(true);
    try {
      const result = await bindings.app.commands.avatarHandoff.launch({
        agentHandle: selectedAgentHandle,
        conversationAnchorId: presentation.activeConversationAnchorId,
        avatarInstanceId,
        launchSource: 'desktop-agent-chat',
      });
      return {
        kind: result.opened ? 'success' as const : 'warning' as const,
        message: result.opened
          ? presentation.t('Chat.agentCenterAvatarStartSuccess', {
            defaultValue: 'Avatar is open.',
          })
          : presentation.t('Chat.agentCenterAvatarStartUnconfirmed', {
            defaultValue: 'Avatar launch-or-focus was sent, but the OS did not confirm it.',
          }),
      };
    } finally {
      setAvatarActionPending(false);
    }
  }, [
    avatarHandoffReady,
    avatarInstanceId,
    avatarRuntimeAccountReady,
    bindings,
    input.avatarConfigured,
    presentation.activeConversationAnchorId,
    presentation.activeTarget,
    presentation.onOpenAgentCenter,
    presentation.t,
    selectedAgentHandle,
  ]);

  return {
    avatarComposerActionState: resolveAvatarComposerActionState({
      avatarActionPending,
      avatarHandoffReady,
      avatarRuntimeAccountReady,
      avatarConfigured: input.avatarConfigured,
    }),
    handleComposerAvatarAction,
  };
}
