import type {
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentConversationSelection } from './chat-shell-types';
import {
  resolveAgentFooterViewState,
  type AgentFooterViewState,
} from './chat-agent-shell-footer-state';
import {
  resolveCompletedAgentSubmitHostFlow,
  resolveInterruptedAgentSubmitHostFlow,
  type AgentHostFlowFooterState,
} from './chat-agent-shell-host-flow';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import { resolveAgentProjectionRefreshOutcome } from './chat-agent-shell-projection-refresh';
import type { StreamState } from '../turns/stream-controller';

export type AgentHostInteractionPatch = {
  bundle: AgentLocalThreadBundle;
  selection: AgentConversationSelection;
  composerText: string;
  footerState: AgentHostFlowFooterState;
  footerViewState: AgentFooterViewState;
  lifecycle: AgentTurnLifecycleState;
};

function createHostInteractionPatch(input: {
  bundle: AgentLocalThreadBundle;
  selection: AgentConversationSelection;
  composerText: string;
  footerState: AgentHostFlowFooterState;
  lifecycle: AgentTurnLifecycleState;
  streamSnapshot: StreamState;
}): AgentHostInteractionPatch {
  return {
    bundle: input.bundle,
    selection: input.selection,
    composerText: input.composerText,
    footerState: input.footerState,
    footerViewState: resolveAgentFooterViewState({
      streamState: input.streamSnapshot,
      lifecycle: input.lifecycle,
      currentHostFooterState: input.footerState,
      isSubmitting: false,
    }),
    lifecycle: input.lifecycle,
  };
}

export function resolveCompletedAgentHostInteraction(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  lifecycle: AgentTurnLifecycleState;
  streamSnapshot: StreamState;
}): AgentHostInteractionPatch | null {
  const hostFlow = resolveCompletedAgentSubmitHostFlow(input);
  if (!hostFlow.outcome) {
    return null;
  }
  return createHostInteractionPatch({
    bundle: hostFlow.outcome.bundle,
    selection: hostFlow.outcome.selection,
    composerText: hostFlow.outcome.composerText,
    footerState: hostFlow.footerState,
    lifecycle: input.lifecycle,
    streamSnapshot: input.streamSnapshot,
  });
}

export function resolveInterruptedAgentHostInteraction(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  fallbackThread: AgentLocalThreadRecord;
  assistantMessageId: string;
  assistantPlaceholder: AgentLocalMessageRecord;
  partialText: string;
  partialReasoningText: string;
  runtimeError: AgentLocalMessageError;
  traceId: string | null;
  submittedText: string;
  updatedAtMs: number;
  lifecycle: AgentTurnLifecycleState;
  streamSnapshot: StreamState;
}): AgentHostInteractionPatch {
  const hostFlow = resolveInterruptedAgentSubmitHostFlow(input);
  return createHostInteractionPatch({
    bundle: hostFlow.outcome.bundle,
    selection: hostFlow.outcome.selection,
    composerText: hostFlow.outcome.composerText,
    footerState: hostFlow.footerState,
    lifecycle: input.lifecycle,
    streamSnapshot: input.streamSnapshot,
  });
}

export function resolveProjectionRefreshAgentHostInteraction(input: {
  lifecycle: AgentTurnLifecycleState;
  streamSnapshot: StreamState;
  currentBundle?: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
  composerText: string;
}): AgentHostInteractionPatch | null {
  const refreshOutcome = resolveAgentProjectionRefreshOutcome({
    terminal: input.lifecycle.terminal,
    currentBundle: input.currentBundle,
    refreshedBundle: input.refreshedBundle,
  });
  if (!refreshOutcome) {
    return null;
  }
  return createHostInteractionPatch({
    bundle: refreshOutcome.bundle,
    selection: refreshOutcome.selection,
    composerText: input.composerText,
    footerState: 'hidden',
    lifecycle: input.lifecycle,
    streamSnapshot: input.streamSnapshot,
  });
}
