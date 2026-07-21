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
import type { AgentHostInteractionPatch } from './chat-agent-shell-host-interaction';
import type {
  AgentSubmitDriverEffectQueue,
  AgentSubmitDriverState,
} from './chat-agent-shell-submit-driver';
import { bundleQueryKey } from './chat-agent-shell-core';
import { useAgentVisibleProjectionStore } from './chat-agent-visible-projection-context.js';
import { useStreamController } from '../turns/stream-controller-context.js';

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
  const streamController = useStreamController();
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

  const applyHostInteractionPatch = useCallback((threadId: string, patch: AgentHostInteractionPatch) => {
    input.queryClient.setQueryData(bundleQueryKey(threadId), patch.bundle);
    visibleProjections.set(threadId, patch.bundle);
    input.currentComposerTextRef.current = patch.composerText;
    input.setSelection(patch.selection);
    setFooterHostState(threadId, {
      footerState: patch.footerState,
      lifecycle: patch.lifecycle,
    });
  }, [input, setFooterHostState]);

  const applyDriverEffects = useCallback((threadId: string, effects: AgentSubmitDriverEffectQueue): AgentSubmitDriverState => {
    for (const streamEffect of effects.streamEffects) {
      streamController.feedStreamEvent(threadId, streamEffect);
    }
    if (effects.projectionEffect !== undefined) {
      visibleProjections.set(threadId, effects.projectionEffect);
    }
    for (const bundleEffect of effects.bundleEffects) {
      input.queryClient.setQueryData(bundleQueryKey(threadId), bundleEffect);
      visibleProjections.set(threadId, bundleEffect);
    }
    if (effects.hostPatchEffect) {
      applyHostInteractionPatch(threadId, effects.hostPatchEffect);
    }
    return effects.finalSession;
  }, [applyHostInteractionPatch, input.queryClient, streamController]);

  const syncSelectionToThread = useCallback((thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null) => {
    if (!thread) {
      input.setSelection({
        localAgentRef: null,
        targetId: null,
      });
      return;
    }
    input.setSelection({
      localAgentRef: thread.localAgentRef,
      targetId: thread.localAgentRef,
    });
  }, [input]);

  return {
    applyDriverEffects,
    applyHostInteractionPatch,
    setBundleCache,
    setFooterHostState,
    syncSelectionToThread,
  };
}
