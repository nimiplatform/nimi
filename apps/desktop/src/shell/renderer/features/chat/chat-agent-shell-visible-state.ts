import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { AgentFooterViewState } from './chat-agent-shell-footer-state';

export type AgentConversationSurfaceState = {
  composer: {
    disabled: boolean;
    disabledReason: string | null;
    placeholder: string;
  } | null;
  character: {
    name: string;
    avatarUrl: string | null;
    avatarFallback: string;
    handle: string | null;
    bio: string | null;
    interactionState: {
      phase: 'thinking' | 'idle';
      busy: boolean;
    };
  };
  footer: AgentFooterViewState & {
    shouldRender: boolean;
  };
};

export function resolveAgentConversationSurfaceState(input: {
  composerReady: boolean;
  activeTarget: AgentLocalTargetSnapshot | null;
  submittingThreadId: string | null;
  footerViewState: AgentFooterViewState;
  labels: {
    title: string;
    sendingDisabledReason: string;
    composerPlaceholderWithTarget: string;
    composerPlaceholderWithoutTarget: string;
  };
}): AgentConversationSurfaceState {
  const isSubmitting = Boolean(input.submittingThreadId);
  const displayName = input.activeTarget?.displayName || input.labels.title;
  return {
    composer: input.composerReady
      ? {
        disabled: isSubmitting,
        disabledReason: isSubmitting ? input.labels.sendingDisabledReason : null,
        placeholder: input.activeTarget
          ? input.labels.composerPlaceholderWithTarget
          : input.labels.composerPlaceholderWithoutTarget,
      }
      : null,
    character: {
      name: displayName || 'Agent',
      avatarUrl: input.activeTarget?.avatarUrl || null,
      avatarFallback: (displayName || 'A').charAt(0).toUpperCase() || 'A',
      handle: input.activeTarget?.handle ? `@${input.activeTarget.handle}` : null,
      bio: input.activeTarget?.bio || null,
      interactionState: {
        phase: isSubmitting ? 'thinking' : 'idle',
        busy: isSubmitting,
      },
    },
    footer: {
      ...input.footerViewState,
      shouldRender: input.footerViewState.displayState !== 'hidden',
    },
  };
}
