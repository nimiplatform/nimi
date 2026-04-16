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
    avatarPresentationProfile: AgentLocalTargetSnapshot['presentationProfile'];
    avatarFallback: string;
    handle: string | null;
    bio: string | null;
    interactionState: {
      phase: 'thinking' | 'idle' | 'listening' | 'loading' | 'speaking';
      busy: boolean;
      label?: string;
      emotion?: 'neutral' | 'joy' | 'focus' | 'calm' | 'playful' | 'concerned' | 'surprised';
      amplitude?: number;
      visemeId?: string;
    };
  };
  footer: AgentFooterViewState & {
    shouldRender: boolean;
  };
};

function clampUnit(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function resolveSpeakingEmotion(input: {
  amplitude: number;
  visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
}): 'joy' | 'focus' | 'calm' {
  const amplitude = clampUnit(input.amplitude);
  switch (input.visemeId) {
    case 'ee':
    case 'ih':
      return 'focus';
    case 'oh':
    case 'ou':
      return amplitude > 0.54 ? 'joy' : 'calm';
    case 'aa':
      return amplitude < 0.24 ? 'calm' : 'joy';
    default:
      if (amplitude < 0.22) {
        return 'calm';
      }
      return amplitude > 0.56 ? 'joy' : 'focus';
  }
}

export function resolveAgentConversationSurfaceState(input: {
  composerReady: boolean;
  activeTarget: AgentLocalTargetSnapshot | null;
  submittingThreadId: string | null;
  voiceCaptureState: {
    active: boolean;
    amplitude: number;
  } | null;
  voicePlaybackState: {
    threadId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  } | null;
  activeThreadId: string | null;
  voiceSessionState: AgentVoiceSessionShellState;
  footerViewState: AgentFooterViewState;
  labels: {
    title: string;
    sendingDisabledReason: string;
    composerPlaceholderWithTarget: string;
    composerPlaceholderWithoutTarget: string;
    voiceSpeakingLabel: string;
    voiceHandsFreeLabel: string;
    voiceListeningLabel: string;
    voiceTranscribingLabel: string;
  };
}): AgentConversationSurfaceState {
  const isSubmitting = Boolean(input.submittingThreadId);
  const displayName = input.activeTarget?.displayName || input.labels.title;
  const activeVoiceCapture = input.voiceCaptureState?.active
    ? input.voiceCaptureState
    : null;
  const activeVoicePlayback = input.voicePlaybackState?.active
    && input.activeThreadId
    && input.voicePlaybackState.threadId === input.activeThreadId
      ? input.voicePlaybackState
      : null;
  const interactionState = isSubmitting
    ? {
      phase: 'thinking' as const,
      busy: true,
      emotion: 'focus' as const,
      amplitude: 0.42,
    }
    : activeVoiceCapture
      ? {
        phase: 'listening' as const,
        busy: true,
        label: input.labels.voiceListeningLabel,
        emotion: 'calm' as const,
        amplitude: activeVoiceCapture.amplitude,
      }
    : activeVoicePlayback
      ? {
        phase: 'speaking' as const,
        busy: true,
        label: input.labels.voiceSpeakingLabel,
        emotion: resolveSpeakingEmotion({
          amplitude: activeVoicePlayback.amplitude,
          visemeId: activeVoicePlayback.visemeId,
        }),
        amplitude: clampUnit(activeVoicePlayback.amplitude),
        ...(activeVoicePlayback.visemeId ? { visemeId: activeVoicePlayback.visemeId } : {}),
      }
    : input.voiceSessionState.status === 'listening'
      ? {
        phase: 'listening' as const,
        busy: true,
        label: input.labels.voiceListeningLabel,
        emotion: 'calm' as const,
        amplitude: 0.3,
      }
      : input.voiceSessionState.status === 'transcribing'
        ? {
          phase: 'loading' as const,
          busy: true,
          label: input.labels.voiceTranscribingLabel,
          emotion: 'focus' as const,
          amplitude: 0.18,
        }
        : input.voiceSessionState.mode === 'hands-free'
          ? {
            phase: 'idle' as const,
            busy: false,
            label: input.labels.voiceHandsFreeLabel,
            emotion: 'calm' as const,
            amplitude: 0.14,
          }
        : {
          phase: 'idle' as const,
          busy: false,
          emotion: 'neutral' as const,
          amplitude: 0.08,
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
      avatarPresentationProfile: input.activeTarget?.presentationProfile || null,
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
