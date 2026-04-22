import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { AgentResolvedStatusCue } from './chat-agent-behavior';
import type { AgentFooterViewState } from './chat-agent-shell-footer-state';
import type { AgentVoiceSessionShellState } from './chat-agent-voice-session';

export type RuntimeCommittedStatusProjection = {
  lifecycleStatus: string | null;
  executionState: string | null;
  statusText: string | null;
};

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

function resolveStatusCueInteractionState(
  statusCue: AgentResolvedStatusCue | null | undefined,
): AgentConversationSurfaceState['character']['interactionState'] | null {
  if (!statusCue) {
    return null;
  }
  return {
    phase: 'idle',
    busy: false,
    ...(statusCue.label || statusCue.actionCue ? { label: statusCue.label || statusCue.actionCue || undefined } : {}),
    ...(statusCue.mood ? { emotion: statusCue.mood } : {}),
    amplitude: clampUnit(statusCue.intensity ?? 0.14),
  };
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function resolveRuntimeProjectionLabel(
  projection: RuntimeCommittedStatusProjection | null | undefined,
): string | null {
  if (!projection) {
    return null;
  }
  if (typeof projection.statusText === 'string' && projection.statusText.trim().length > 0) {
    return projection.statusText.trim();
  }
  switch (projection.executionState) {
    case 'chat-active':
      return 'Chat active';
    case 'life-pending':
      return 'Life pending';
    case 'life-running':
      return 'Life running';
    case 'suspended':
      return 'Suspended';
    case 'idle':
      return null;
    default:
      break;
  }
  switch (projection.lifecycleStatus) {
    case 'initializing':
      return 'Initializing';
    case 'suspended':
      return 'Suspended';
    case 'terminating':
      return 'Terminating';
    case 'terminated':
      return 'Terminated';
    case 'active':
      return null;
    default:
      break;
  }
  const executionFallback = typeof projection.executionState === 'string'
    ? projection.executionState.trim()
    : '';
  if (executionFallback) {
    return titleCaseWords(executionFallback.replace(/-/g, ' '));
  }
  const lifecycleFallback = typeof projection.lifecycleStatus === 'string'
    ? projection.lifecycleStatus.trim()
    : '';
  return lifecycleFallback
    ? titleCaseWords(lifecycleFallback.replace(/-/g, ' '))
    : null;
}

function resolveRuntimeProjectionInteractionState(
  projection: RuntimeCommittedStatusProjection | null | undefined,
): AgentConversationSurfaceState['character']['interactionState'] | null {
  const label = resolveRuntimeProjectionLabel(projection);
  if (!label) {
    return null;
  }
  return {
    phase: 'idle',
    busy: false,
    label,
    amplitude: 0.12,
  };
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
  activeConversationAnchorId: string | null;
  voiceCaptureState: {
    active: boolean;
    amplitude: number;
  } | null;
  voicePlaybackState: {
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  } | null;
  activeThreadId: string | null;
  voiceSessionState: AgentVoiceSessionShellState;
  latestStatusCue?: AgentResolvedStatusCue | null;
  runtimeCommittedStatus?: RuntimeCommittedStatusProjection | null;
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
    && input.activeConversationAnchorId
    && input.voicePlaybackState.conversationAnchorId === input.activeConversationAnchorId
      ? input.voicePlaybackState
      : null;
  const statusCueInteractionState = resolveStatusCueInteractionState(input.latestStatusCue || null);
  const runtimeProjectionInteractionState = resolveRuntimeProjectionInteractionState(input.runtimeCommittedStatus || null);
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
      : statusCueInteractionState
        ? statusCueInteractionState
        : runtimeProjectionInteractionState
          ? runtimeProjectionInteractionState
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
