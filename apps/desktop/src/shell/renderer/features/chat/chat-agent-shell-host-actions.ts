import { useCallback, useEffect, useRef } from 'react';
import {
  normalizeText,
} from './chat-agent-shell-core';
import type { PendingAttachment } from '../turns/turn-input-attachments';
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
  handleSelectAgent: (localAgentRef: string | null) => void;
  handleSelectThread: (threadId: string) => void;
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
} {
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
    input.currentDraftTextRef.current = '';
    input.syncSelectionToThread(nextThread);
  }, [input]);

  const handleSelectAgent = useCallback((localAgentRef: string | null) => {
    if (input.submittingThreadId) {
      return;
    }
    void (async () => {
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
  }, [input]);

  const handleSubmit = useCallback(async (payload: AgentConversationSubmitPayload) => {
    await submitAgentConversationTurn({
      hostInput: input,
      payload,
      activeSubmitsByThreadRef,
      submittingLockTokenRef,
    });
  }, [input]);

  return {
    handleSelectAgent,
    handleSelectThread,
    handleSubmit,
  };
}
