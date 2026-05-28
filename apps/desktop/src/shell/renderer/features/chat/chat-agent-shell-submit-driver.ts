import type {
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type { ConversationTurnEvent } from '@nimiplatform/kit/features/chat/headless';
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
  projectionEffect?: AgentLocalThreadBundle | null;
  hostPatchEffect: AgentHostInteractionPatch | null;
  awaitRefresh: boolean;
};

function createEffectQueue(input: {
  finalSession: AgentSubmitDriverState;
  streamEffects?: StreamEvent[];
  bundleEffects?: AgentLocalThreadBundle[];
  projectionEffect?: AgentLocalThreadBundle | null;
  hostPatchEffect?: AgentHostInteractionPatch | null;
  awaitRefresh?: boolean;
}): AgentSubmitDriverEffectQueue {
  return {
    finalSession: input.finalSession,
    streamEffects: input.streamEffects || [],
    bundleEffects: input.bundleEffects || [],
    projectionEffect: input.projectionEffect,
    hostPatchEffect: input.hostPatchEffect || null,
    awaitRefresh: input.awaitRefresh === true,
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
    bundleEffects: nextStep.persistedBundle ? [nextStep.persistedBundle] : [],
    projectionEffect: nextStep.projectionBundle,
    awaitRefresh: input.event.type === 'projection-rebuilt',
  });
}

export function resolveAgentSubmitDriverProjectionRefresh(input: {
  state: AgentSubmitDriverState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  draftText: string;
  streamSnapshot: StreamState;
}): AgentSubmitDriverEffectQueue {
  const refreshOutcome = resolveProjectionRefreshAgentSubmitSession({
    state: input.state,
    refreshedBundle: input.refreshedBundle,
    draftText: input.draftText,
    streamSnapshot: input.streamSnapshot,
  });
  return createEffectQueue({
    finalSession: refreshOutcome.state,
    projectionEffect: null,
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
    projectionEffect: null,
    hostPatchEffect: completed.hostInteractionPatch,
  });
}

export function resolveInterruptedAgentSubmitDriverCheckpoint(input: {
  state: AgentSubmitDriverState;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  runtimeError: AgentLocalMessageError;
  updatedAtMs: number;
  streamSnapshot: StreamState;
}): AgentSubmitDriverEffectQueue {
  const interrupted = resolveInterruptedAgentSubmitSession({
    state: input.state,
    refreshedBundle: input.refreshedBundle,
    runtimeError: input.runtimeError,
    updatedAtMs: input.updatedAtMs,
    streamSnapshot: input.streamSnapshot,
  });
  return createEffectQueue({
    finalSession: interrupted.state,
    streamEffects: interrupted.errorStreamEvent ? [interrupted.errorStreamEvent] : [],
    projectionEffect: null,
    hostPatchEffect: interrupted.hostInteractionPatch,
  });
}
