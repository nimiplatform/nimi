import type {
  AgentLocalDraftRecord,
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type { ConversationTurnEvent } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { AgentHostInteractionPatch } from './chat-agent-shell-host-interaction';
import {
  createInitialAgentSubmitSessionState,
  reduceAgentSubmitSessionEvent,
  resolveCompletedAgentSubmitSession,
  resolveInterruptedAgentSubmitSession,
  resolveProjectionRefreshAgentSubmitSession,
  type AgentSubmitSessionState,
} from './chat-agent-shell-submit-session';
import type { StreamEvent, StreamState } from '../turns/stream-controller';

export type AgentSubmitDriverState = AgentSubmitSessionState;

export type AgentSubmitDriverEffectQueue = {
  finalSession: AgentSubmitDriverState;
  streamEffects: StreamEvent[];
  bundleEffects: AgentLocalThreadBundle[];
  hostPatchEffect: AgentHostInteractionPatch | null;
  awaitRefresh: {
    requestedProjectionVersion: string;
  } | null;
};

function createEffectQueue(input: {
  finalSession: AgentSubmitDriverState;
  streamEffects?: StreamEvent[];
  bundleEffects?: AgentLocalThreadBundle[];
  hostPatchEffect?: AgentHostInteractionPatch | null;
  awaitRefresh?: {
    requestedProjectionVersion: string;
  } | null;
}): AgentSubmitDriverEffectQueue {
  return {
    finalSession: input.finalSession,
    streamEffects: input.streamEffects || [],
    bundleEffects: input.bundleEffects || [],
    hostPatchEffect: input.hostPatchEffect || null,
    awaitRefresh: input.awaitRefresh || null,
  };
}

export function createInitialAgentSubmitDriverState(input: {
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  submittedText: string;
  workingBundle: AgentLocalThreadBundle | null;
}): AgentSubmitDriverState {
  return createInitialAgentSubmitSessionState(input);
}

export function reduceAgentSubmitDriverEvent(input: {
  state: AgentSubmitDriverState;
  event: ConversationTurnEvent;
  updatedAtMs: number;
}): AgentSubmitDriverEffectQueue {
  const nextStep = reduceAgentSubmitSessionEvent(input.state, {
    event: input.event,
    updatedAtMs: input.updatedAtMs,
  });
  return createEffectQueue({
    finalSession: nextStep.state,
    streamEffects: nextStep.streamEvent ? [nextStep.streamEvent] : [],
    bundleEffects: nextStep.visibleBundle ? [nextStep.visibleBundle] : [],
    awaitRefresh: input.event.type === 'projection-rebuilt'
      ? { requestedProjectionVersion: input.event.projectionVersion }
      : null,
  });
}

export function resolveAgentSubmitDriverProjectionRefresh(input: {
  state: AgentSubmitDriverState;
  requestedProjectionVersion: string;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  draftText: string;
  streamSnapshot: StreamState;
}): AgentSubmitDriverEffectQueue {
  const refreshOutcome = resolveProjectionRefreshAgentSubmitSession({
    state: input.state,
    requestedProjectionVersion: input.requestedProjectionVersion,
    refreshedBundle: input.refreshedBundle,
    draftText: input.draftText,
    streamSnapshot: input.streamSnapshot,
  });
  return createEffectQueue({
    finalSession: refreshOutcome.state,
    hostPatchEffect: refreshOutcome.hostInteractionPatch,
  });
}

export function resolveCompletedAgentSubmitDriverCheckpoint(input: {
  state: AgentSubmitDriverState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  streamSnapshot: StreamState;
}): AgentSubmitDriverEffectQueue {
  const completed = resolveCompletedAgentSubmitSession({
    state: input.state,
    refreshedBundle: input.refreshedBundle,
    streamSnapshot: input.streamSnapshot,
  });
  return createEffectQueue({
    finalSession: completed.state,
    hostPatchEffect: completed.hostInteractionPatch,
  });
}

export function resolveInterruptedAgentSubmitDriverCheckpoint(input: {
  state: AgentSubmitDriverState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  runtimeError: AgentLocalMessageError;
  draft: AgentLocalDraftRecord;
  updatedAtMs: number;
  streamSnapshot: StreamState;
}): AgentSubmitDriverEffectQueue {
  const interrupted = resolveInterruptedAgentSubmitSession({
    state: input.state,
    refreshedBundle: input.refreshedBundle,
    runtimeError: input.runtimeError,
    draft: input.draft,
    updatedAtMs: input.updatedAtMs,
    streamSnapshot: input.streamSnapshot,
  });
  return createEffectQueue({
    finalSession: interrupted.state,
    streamEffects: interrupted.errorStreamEvent ? [interrupted.errorStreamEvent] : [],
    hostPatchEffect: interrupted.hostInteractionPatch,
  });
}
