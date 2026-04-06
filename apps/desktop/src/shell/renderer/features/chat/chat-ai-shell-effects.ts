import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  ChatAiThreadBundle,
  ChatAiThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import type { AiConversationSelection } from './chat-shell-types';
import { bundleQueryKey, THREADS_QUERY_KEY } from './chat-ai-shell-core';

type UseAiConversationEffectsInput = {
  queryClient: QueryClient;
  setSelection: (selection: AiConversationSelection) => void;
};

export function useAiConversationEffects(input: UseAiConversationEffectsInput) {
  const setThreadsCache = useCallback((updater: (current: ChatAiThreadSummary[]) => ChatAiThreadSummary[]) => {
    input.queryClient.setQueryData<ChatAiThreadSummary[]>(THREADS_QUERY_KEY, (current) => {
      const safeCurrent = Array.isArray(current) ? current : [];
      return updater(safeCurrent);
    });
  }, [input.queryClient]);

  const setBundleCache = useCallback((
    threadId: string,
    updater: (current: ChatAiThreadBundle | null | undefined) => ChatAiThreadBundle | null | undefined,
  ) => {
    input.queryClient.setQueryData<ChatAiThreadBundle | null>(
      bundleQueryKey(threadId),
      (current) => updater(current),
    );
  }, [input.queryClient]);

  const syncSelectionToThread = useCallback((threadId: string | null) => {
    input.setSelection({ threadId });
  }, [input]);

  return {
    setBundleCache,
    setThreadsCache,
    syncSelectionToThread,
  };
}
