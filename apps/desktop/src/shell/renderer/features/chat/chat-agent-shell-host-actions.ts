import { useCallback, useEffect, useRef } from 'react';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import {
  bundleQueryKey,
  normalizeText,
} from './chat-agent-shell-core';
import { clearAgentConversationAnchorBinding } from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import {
  persistDraftForThread,
} from './chat-agent-shell-host-actions-helpers';
import { submitAgentConversationTurn } from './chat-agent-shell-host-actions-submit';
import type {
  ActiveAgentSubmit,
  AgentConversationSubmitPayload,
  UseAgentConversationHostActionsInput,
} from './chat-agent-shell-host-actions-types';

export { assertAgentSubmitSchedulingAllowed } from './chat-agent-shell-host-actions-helpers';

export function useAgentConversationHostActions(
  input: UseAgentConversationHostActionsInput,
): {
  handleDeleteThread: (threadId: string) => Promise<void>;
  handleSelectAgent: (localAgentRef: string | null) => void;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
} {
  useEffect(() => {
    input.currentDraftTextRef.current = input.draftText || '';
  }, [input.currentDraftTextRef, input.draftText, input.draftUpdatedAtMs]);

  const persistDraft = useCallback(
    async (threadId: string | null) => persistDraftForThread(input, threadId),
    [input],
  );

  useEffect(() => {
    if (!input.threadsReady) {
      return;
    }
    if (input.activeThreadId && !input.threads.some((thread) => thread.id === input.activeThreadId) && !input.selectedLocalAgentRef) {
      input.syncSelectionToThread(null);
      return;
    }
    if (!input.activeThreadId && input.selectedThreadRecord) {
      input.syncSelectionToThread(input.selectedThreadRecord);
    }
  }, [input]);

  const activeSubmitsByThreadRef = useRef<Map<string, ActiveAgentSubmit>>(new Map());
  const submittingLockTokenRef = useRef(0);

  const handleSelectThread = useCallback((threadId: string) => {
    if (!threadId || threadId === input.activeThreadId || input.submittingThreadId) {
      return;
    }
    const nextThread = input.threads.find((thread) => thread.id === threadId) || null;
    if (!nextThread) {
      return;
    }
    void (async () => {
      await persistDraft(input.activeThreadId);
      input.currentDraftTextRef.current = '';
      input.syncSelectionToThread(nextThread);
    })().catch(input.reportHostError);
  }, [input, persistDraft]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const thread = input.threads.find((item) => item.id === normalizedThreadId) || null;
    if (!thread) {
      return;
    }
    await chatAgentStoreClient.deleteThread(normalizedThreadId);
    clearAgentConversationAnchorBinding(normalizedThreadId);
    input.queryClient.removeQueries({ queryKey: bundleQueryKey(normalizedThreadId) });
    input.setFooterHostState(normalizedThreadId, null);
    input.setThreadsCache((current) => current.filter((item) => item.id !== normalizedThreadId));
    if (input.activeThreadId === normalizedThreadId) {
      input.currentDraftTextRef.current = '';
      if (input.activeTarget?.localAgentRef === thread.localAgentRef) {
        input.setSelectionForLocalAgentRef(thread.localAgentRef);
      } else {
        input.syncSelectionToThread(null);
        input.clearSelectedTarget();
      }
    }
  }, [input]);

  const handleSelectAgent = useCallback((localAgentRef: string | null) => {
    if (input.submittingThreadId) {
      return;
    }
    void (async () => {
      await persistDraft(input.activeThreadId);
      input.currentDraftTextRef.current = '';
      const normalizedLocalAgentRef = normalizeText(localAgentRef);
      if (!normalizedLocalAgentRef) {
        input.syncSelectionToThread(null);
        return;
      }
      const target = input.targetByLocalAgentRef.get(normalizedLocalAgentRef);
      if (!target) {
        throw new Error(input.t('Chat.agentTargetMissing', {
          defaultValue: 'The selected agent friend is no longer available.',
        }));
      }
      input.setSelectionForLocalAgentRef(target.localAgentRef);
    })().catch(input.reportHostError);
  }, [input, persistDraft]);

  const handleSubmit = useCallback(async (payload: AgentConversationSubmitPayload) => {
    await submitAgentConversationTurn({
      hostInput: input,
      payload,
      activeSubmitsByThreadRef,
      submittingLockTokenRef,
    });
  }, [input]);

  return {
    handleDeleteThread,
    handleSelectAgent,
    handleSelectThread,
    handleSubmit,
  };
}
