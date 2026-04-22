import { useCallback, useEffect, useRef } from 'react';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import {
  bundleQueryKey,
  normalizeText,
  upsertThreadSummary,
} from './chat-agent-shell-core';
import { clearAgentConversationAnchorBinding } from './chat-agent-anchor-binding-storage';
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
  handleDeleteMessage: (messageId: string) => Promise<void>;
  handleDeleteThread: (threadId: string) => Promise<void>;
  handleSelectAgent: (agentId: string | null) => void;
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
    if (input.activeThreadId && !input.threads.some((thread) => thread.id === input.activeThreadId) && !input.selectedAgentId) {
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
      if (input.activeTarget?.agentId === thread.agentId) {
        input.setSelectionForAgent(thread.agentId);
      } else {
        input.syncSelectionToThread(null);
        input.clearSelectedTarget();
      }
    }
  }, [input]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    const normalizedMessageId = normalizeText(messageId);
    if (!normalizedMessageId || !input.activeThreadId) {
      return;
    }
    const bundle = input.bundle;
    if (!bundle || bundle.thread.id !== input.activeThreadId) {
      return;
    }
    if (!bundle.messages.some((message) => message.id === normalizedMessageId)) {
      return;
    }
    const nextBundle = await chatAgentStoreClient.deleteMessage(normalizedMessageId);
    input.setThreadsCache((current) => upsertThreadSummary(current, nextBundle.thread));
    input.queryClient.setQueryData(bundleQueryKey(nextBundle.thread.id), nextBundle);
  }, [input.activeThreadId, input.bundle, input.queryClient, input.setThreadsCache]);

  const handleSelectAgent = useCallback((agentId: string | null) => {
    if (input.submittingThreadId) {
      return;
    }
    void (async () => {
      await persistDraft(input.activeThreadId);
      input.currentDraftTextRef.current = '';
      const normalizedAgentId = normalizeText(agentId);
      if (!normalizedAgentId) {
        input.syncSelectionToThread(null);
        return;
      }
      const target = input.targetByAgentId.get(normalizedAgentId);
      if (!target) {
        throw new Error(input.t('Chat.agentTargetMissing', {
          defaultValue: 'The selected agent friend is no longer available.',
        }));
      }
      input.setSelectionForAgent(target.agentId);
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
    handleDeleteMessage,
    handleDeleteThread,
    handleSelectAgent,
    handleSelectThread,
    handleSubmit,
  };
}
