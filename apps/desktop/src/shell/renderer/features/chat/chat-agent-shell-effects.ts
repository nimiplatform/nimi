import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import type { AgentConversationSelection } from './chat-shell-types';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import { bundleQueryKey } from './chat-agent-shell-core';
import { useAgentVisibleProjectionStore } from './chat-agent-visible-projection-context.js';

type UseAgentConversationEffectsInput = {
  currentComposerTextRef: { current: string };
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
  const visibleProjections = useAgentVisibleProjectionStore();
  const setBundleCache = useCallback((
    threadId: string,
    updater: (current: AgentLocalThreadBundle | null | undefined) => AgentLocalThreadBundle | null | undefined,
  ) => {
    input.queryClient.setQueryData<AgentLocalThreadBundle | null>(
      bundleQueryKey(threadId),
      (current) => {
        const nextBundle = updater(current);
        visibleProjections.set(threadId, nextBundle || null);
        return nextBundle;
      },
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

  const syncSelectionToThread = useCallback((thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null) => {
    if (!thread) {
      input.setSelection({
        agentHandle: null,
        conversationAnchorId: null,
        targetId: null,
      });
      return;
    }
    input.setSelection({
      agentHandle: thread.targetSnapshot.agentHandle || null,
      conversationAnchorId: thread.targetSnapshot.conversationAnchorId || null,
      targetId: thread.targetSnapshot.agentHandle || null,
    });
  }, [input]);

  return {
    setBundleCache,
    setFooterHostState,
    syncSelectionToThread,
  };
}
