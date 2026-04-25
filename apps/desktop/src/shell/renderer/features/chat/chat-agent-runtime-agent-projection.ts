import type { RuntimeAgentConsumeEvent } from '@nimiplatform/sdk/runtime';
import { normalizeText } from './chat-agent-orchestration-shared';

export type RuntimeAgentProjectionSummary = {
  eventName: string;
  agentId: string;
  conversationAnchorId: string | null;
  runtimeTurnId: string | null;
  runtimeStreamId: string | null;
  detail: Record<string, unknown>;
};

export function isRuntimeAgentProjectionEvent(event: RuntimeAgentConsumeEvent): boolean {
  return event.eventName.startsWith('runtime.agent.state.')
    || event.eventName.startsWith('runtime.agent.hook.')
    || event.eventName.startsWith('runtime.agent.presentation.');
}

export function matchesRuntimeAgentProjectionScope(input: {
  event: RuntimeAgentConsumeEvent;
  conversationAnchorId: string;
  currentTurnAccepted: boolean;
  currentRuntimeTurnId: string;
}): boolean {
  const eventRecord = input.event as RuntimeAgentConsumeEvent & {
    conversationAnchorId?: string;
    originatingTurnId?: string;
    turnId?: string;
  };
  const eventAnchorId = normalizeText(eventRecord.conversationAnchorId);
  if (eventAnchorId && eventAnchorId !== input.conversationAnchorId) {
    return false;
  }
  const originTurnId = normalizeText(eventRecord.originatingTurnId);
  if (originTurnId) {
    return input.currentTurnAccepted && originTurnId === input.currentRuntimeTurnId;
  }
  const presentationTurnId = normalizeText(eventRecord.turnId);
  if (presentationTurnId) {
    return input.currentTurnAccepted && presentationTurnId === input.currentRuntimeTurnId;
  }
  return true;
}

export function summarizeRuntimeAgentProjectionEvent(event: RuntimeAgentConsumeEvent): RuntimeAgentProjectionSummary {
  const eventRecord = event as RuntimeAgentConsumeEvent & {
    conversationAnchorId?: string;
    originatingTurnId?: string;
    originatingStreamId?: string;
    turnId?: string;
    streamId?: string;
    detail?: Record<string, unknown>;
  };
  return {
    eventName: event.eventName,
    agentId: normalizeText(eventRecord.agentId),
    conversationAnchorId: normalizeText(eventRecord.conversationAnchorId) || null,
    runtimeTurnId: normalizeText(eventRecord.originatingTurnId) || normalizeText(eventRecord.turnId) || null,
    runtimeStreamId: normalizeText(eventRecord.originatingStreamId) || normalizeText(eventRecord.streamId) || null,
    detail: eventRecord.detail && typeof eventRecord.detail === 'object' && !Array.isArray(eventRecord.detail)
      ? eventRecord.detail
      : {},
  };
}
