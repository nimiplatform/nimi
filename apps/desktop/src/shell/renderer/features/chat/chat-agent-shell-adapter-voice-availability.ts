import type { TFunction } from 'i18next';
import {
  getRuntimeRouteCapabilityProjectionIssueKind,
  isRuntimeRouteCapabilityProjectionReady,
} from '@nimiplatform/sdk/runtime';
import type { ConversationCapabilityProjection } from './conversation-capability';
import { normalizeAgentVoiceSessionConversationAnchorId } from './chat-agent-voice-session';

export function resolveIsVoiceSessionForeground(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  const visible = document.visibilityState !== 'hidden';
  const focused = typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : true;
  return visible && focused;
}

export function resolveVoiceSessionUnavailableMessage(input: {
  activeTarget: { localAgentRef: string } | null;
  activeConversationAnchorId: string | null;
  activeThreadId: string | null;
  t: TFunction;
  transcribeCapabilityProjection: ConversationCapabilityProjection | null;
}): string | null {
  if (!input.activeTarget) {
    return input.t('Chat.voiceSessionTargetRequired', {
      defaultValue: 'Select an agent before starting voice input.',
    });
  }
  if (!input.activeThreadId || !normalizeAgentVoiceSessionConversationAnchorId(input.activeConversationAnchorId)) {
    return input.t('Chat.voiceSessionAnchorRequired', {
      defaultValue: 'Voice input is unavailable because the conversation anchor is not ready.',
    });
  }
  const issueKind = getRuntimeRouteCapabilityProjectionIssueKind(input.transcribeCapabilityProjection);
  if (issueKind === 'needs_selection') {
    return input.t('Chat.voiceSessionRouteRequired', {
      defaultValue: 'Voice input is unavailable because no transcribe route is configured.',
    });
  }
  if (issueKind === 'route_unhealthy') {
    return input.t('Chat.voiceSessionRuntimeUnavailable', {
      defaultValue: 'Voice input is unavailable because the transcribe runtime is not ready.',
    });
  }
  if (issueKind === 'metadata_missing' || issueKind === 'binding_unresolved') {
    return input.t('Chat.voiceSessionRouteUnavailable', {
      defaultValue: 'Voice input is unavailable because the selected transcribe route cannot be resolved.',
    });
  }
  if (!isRuntimeRouteCapabilityProjectionReady(input.transcribeCapabilityProjection)) {
    return input.t('Chat.voiceSessionUnavailable', {
      defaultValue: 'Voice input is unavailable for the current conversation.',
    });
  }
  return null;
}
