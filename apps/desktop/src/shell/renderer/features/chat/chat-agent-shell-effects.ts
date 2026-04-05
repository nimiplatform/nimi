import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentConversationSelection } from './chat-shell-types';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type { AgentHostInteractionPatch } from './chat-agent-shell-host-interaction';
import type {
  AgentSubmitDriverEffectQueue,
  AgentSubmitDriverState,
} from './chat-agent-shell-submit-driver';
import { bundleQueryKey, THREADS_QUERY_KEY, upsertThreadSummary } from './chat-agent-shell-core';
import { feedStreamEvent } from '../turns/stream-controller';

type UseAgentConversationEffectsInput = {
  currentDraftTextRef: { current: string };
  queryClient: QueryClient;
  setFooterHostStateByThreadId: Dispatch<SetStateAction<
    Record<string, {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    }>
  >>;
  setSelection: (selection: AgentConversationSelection) => void;
};

export function useAgentConversationEffects(input: UseAgentConversationEffectsInput) {
  const setThreadsCache = useCallback((updater: (current: AgentLocalThreadSummary[]) => AgentLocalThreadSummary[]) => {
    input.queryClient.setQueryData<AgentLocalThreadSummary[]>(THREADS_QUERY_KEY, (current) => {
      const safeCurrent = Array.isArray(current) ? current : [];
      return updater(safeCurrent);
    });
  }, [input.queryClient]);

  const setBundleCache = useCallback((
    threadId: string,
    updater: (current: AgentLocalThreadBundle | null | undefined) => AgentLocalThreadBundle | null | undefined,
  ) => {
    input.queryClient.setQueryData<AgentLocalThreadBundle | null>(
      bundleQueryKey(threadId),
      (current) => updater(current),
    );
  }, [input.queryClient]);

  const setFooterHostState = useCallback((
    threadId: string,
    nextState: {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    } | null,
  ) => {
    input.setFooterHostStateByThreadId((current) => {
      if (nextState === null) {
        if (!(threadId in current)) {
          return current;
        }
        const { [threadId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [threadId]: nextState,
      };
    });
  }, [input]);

  const applyHostInteractionPatch = useCallback((threadId: string, patch: AgentHostInteractionPatch) => {
    setThreadsCache((current) => upsertThreadSummary(current, patch.bundle.thread));
    input.queryClient.setQueryData(bundleQueryKey(threadId), patch.bundle);
    input.currentDraftTextRef.current = patch.draftText;
    input.setSelection(patch.selection);
    setFooterHostState(threadId, {
      footerState: patch.footerState,
      lifecycle: patch.lifecycle,
    });
  }, [input, setFooterHostState, setThreadsCache]);

  const applyDriverEffects = useCallback((threadId: string, effects: AgentSubmitDriverEffectQueue): AgentSubmitDriverState => {
    for (const streamEffect of effects.streamEffects) {
      feedStreamEvent(threadId, streamEffect);
    }
    for (const bundleEffect of effects.bundleEffects) {
      input.queryClient.setQueryData(bundleQueryKey(threadId), bundleEffect);
    }
    if (effects.hostPatchEffect) {
      applyHostInteractionPatch(threadId, effects.hostPatchEffect);
    }
    return effects.finalSession;
  }, [applyHostInteractionPatch, input.queryClient]);

  const syncSelectionToThread = useCallback((thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null) => {
    if (!thread) {
      input.setSelection({
        threadId: null,
        agentId: null,
        targetId: null,
      });
      return;
    }
    input.setSelection({
      threadId: thread.id,
      agentId: thread.agentId,
      targetId: thread.agentId,
    });
  }, [input]);

  return {
    applyDriverEffects,
    applyHostInteractionPatch,
    setBundleCache,
    setFooterHostState,
    setThreadsCache,
    syncSelectionToThread,
  };
}
