import { useCallback, useEffect, useRef } from 'react';
import {
  normalizeText,
} from './chat-agent-shell-core';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { submitAgentConversationTurn } from './chat-agent-shell-host-actions-submit';
import { useAgentVisibleProjectionStore } from './chat-agent-visible-projection-context.js';
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
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
} {
  const visibleProjections = useAgentVisibleProjectionStore();
  useEffect(() => {
    if (!input.threadsReady) {
      return;
    }
    if (input.selectedLocalAgentRef && !input.targetByLocalAgentRef.has(input.selectedLocalAgentRef)) {
      input.syncSelectionToThread(null);
    }
  }, [input]);

  const activeSubmitsByThreadRef = useRef<Map<string, ActiveAgentSubmit>>(new Map());
  const submittingLockTokenRef = useRef(0);

  const handleSelectAgent = useCallback((localAgentRef: string | null) => {
    if (input.submittingThreadId) {
      return;
    }
    void (async () => {
      input.currentComposerTextRef.current = '';
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
      visibleProjections,
    });
  }, [input]);

  return {
    handleSelectAgent,
    handleSubmit,
  };
}
