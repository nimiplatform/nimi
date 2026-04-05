import type {
  AgentLocalDraftRecord,
  AgentLocalMessageError,
  AgentLocalMessageRecord,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentConversationSelection } from './chat-shell-types';
import {
  resolveCompletedAgentThreadBundle,
  resolveInterruptedAgentThreadBundle,
} from './chat-agent-shell-bundle';

export type AgentSubmitOutcomeState = {
  bundle: AgentLocalThreadBundle;
  selection: AgentConversationSelection;
  draftText: string;
};

function toSelection(thread: AgentLocalThreadRecord): AgentConversationSelection {
  return {
    threadId: thread.id,
    agentId: thread.agentId,
    targetId: thread.agentId,
  };
}

export function resolveCompletedAgentSubmitOutcome(input: {
  optimisticBundle: AgentLocalThreadBundle | null | undefined;
  refreshedBundle: AgentLocalThreadBundle | null | undefined;
}): AgentSubmitOutcomeState | null {
  const bundle = resolveCompletedAgentThreadBundle({
    optimisticBundle: input.optimisticBundle,
    refreshedBundle: input.refreshedBundle,
  });
  if (!bundle) {
    return null;
  }
  return {
    bundle,
    selection: toSelection(bundle.thread),
    draftText: '',
  };
}

export function resolveInterruptedAgentSubmitOutcome(input: {
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
}): AgentSubmitOutcomeState {
  const bundle = resolveInterruptedAgentThreadBundle({
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
    updatedAtMs: input.updatedAtMs,
  });
  return {
    bundle,
    selection: toSelection(bundle.thread),
    draftText: input.submittedText,
  };
}
