import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { AgentFooterViewState } from './chat-agent-shell-footer-state';
import type { AgentVoiceSessionShellState } from './chat-agent-voice-session';

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
      phase: 'thinking' | 'idle' | 'listening' | 'loading';
      busy: boolean;
      label?: string;
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
  voiceSessionState: AgentVoiceSessionShellState;
  footerViewState: AgentFooterViewState;
  labels: {
    title: string;
    sendingDisabledReason: string;
    composerPlaceholderWithTarget: string;
    composerPlaceholderWithoutTarget: string;
    voiceHandsFreeLabel: string;
    voiceListeningLabel: string;
    voiceTranscribingLabel: string;
  };
}): AgentConversationSurfaceState {
  const isSubmitting = Boolean(input.submittingThreadId);
  const displayName = input.activeTarget?.displayName || input.labels.title;
  const interactionState = isSubmitting
    ? {
      phase: 'thinking' as const,
      busy: true,
    }
    : input.voiceSessionState.status === 'listening'
      ? {
        phase: 'listening' as const,
        busy: true,
        label: input.labels.voiceListeningLabel,
      }
      : input.voiceSessionState.status === 'transcribing'
        ? {
          phase: 'loading' as const,
          busy: true,
          label: input.labels.voiceTranscribingLabel,
        }
        : input.voiceSessionState.mode === 'hands-free'
          ? {
            phase: 'idle' as const,
            busy: false,
            label: input.labels.voiceHandsFreeLabel,
          }
        : {
          phase: 'idle' as const,
          busy: false,
        };
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
      interactionState,
    },
    footer: {
      ...input.footerViewState,
      shouldRender: input.footerViewState.displayState !== 'hidden',
    },
  };
}
