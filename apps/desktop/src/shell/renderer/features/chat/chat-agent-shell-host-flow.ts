import type {
  AgentLocalDraftRecord,
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { AgentSubmitOutcomeState } from './chat-agent-shell-submit-outcome';
import {
  resolveCompletedAgentSubmitOutcome,
  resolveInterruptedAgentSubmitOutcome,
} from './chat-agent-shell-submit-outcome';
import type { StreamState } from '../turns/stream-controller';

export type AgentHostFlowFooterState = 'interrupted' | 'done' | 'hidden';

export type AgentSubmitHostFlowState = {
  outcome: AgentSubmitOutcomeState | null;
  footerState: AgentHostFlowFooterState;
};

export type AgentInterruptedSubmitHostFlowState = {
  outcome: AgentSubmitOutcomeState;
  footerState: AgentHostFlowFooterState;
};

function resolveHostFooterState(input: {
  streamSnapshot: StreamState;
  lifecycle: AgentTurnLifecycleState;
}): AgentHostFlowFooterState {
  if (
    (input.streamSnapshot.phase === 'error' || input.streamSnapshot.phase === 'cancelled')
    && input.streamSnapshot.interrupted
  ) {
    return 'interrupted';
  }
  if (input.streamSnapshot.phase === 'done') {
    return 'done';
  }
  if (input.lifecycle.terminal === 'failed' || input.lifecycle.terminal === 'canceled') {
    return 'interrupted';
  }
  if (input.lifecycle.terminal === 'completed') {
    return 'done';
  }
  return 'hidden';
}

export function resolveCompletedAgentSubmitHostFlow(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  lifecycle: AgentTurnLifecycleState;
  streamSnapshot: StreamState;
}): AgentSubmitHostFlowState {
  return {
    outcome: resolveCompletedAgentSubmitOutcome({
      optimisticBundle: input.optimisticBundle,
      refreshedBundle: input.refreshedBundle,
    }),
    footerState: resolveHostFooterState({
      streamSnapshot: input.streamSnapshot,
      lifecycle: input.lifecycle,
    }),
  };
}

export function resolveInterruptedAgentSubmitHostFlow(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  partialText: string;
  partialReasoningText: string;
  runtimeError: AgentLocalMessageError;
  traceId: string | null;
  draft: AgentLocalDraftRecord;
  submittedText: string;
  updatedAtMs: number;
  lifecycle: AgentTurnLifecycleState;
  streamSnapshot: StreamState;
}): AgentInterruptedSubmitHostFlowState {
  return {
    outcome: resolveInterruptedAgentSubmitOutcome({
      optimisticBundle: input.optimisticBundle,
      refreshedBundle: input.refreshedBundle,
      fallbackThread: input.fallbackThread,
      assistantMessageId: input.assistantMessageId,
      assistantPlaceholder: input.assistantPlaceholder,
      partialText: input.partialText,
      partialReasoningText: input.partialReasoningText,
      runtimeError: input.runtimeError,
      traceId: input.traceId,
      draft: input.draft,
      submittedText: input.submittedText,
      updatedAtMs: input.updatedAtMs,
    }),
    footerState: resolveHostFooterState({
      streamSnapshot: input.streamSnapshot,
      lifecycle: input.lifecycle,
    }),
  };
}
