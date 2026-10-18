import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  normalizeText,
} from './chat-agent-shell-core';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import { submitAgentConversationTurn } from './chat-agent-shell-host-actions-submit';
import { ensureThreadAnchorBindingForTarget } from './chat-agent-shell-host-actions-helpers';
import type {
  AgentConversationSubmitPayload,
  UseAgentConversationHostActionsInput,
} from './chat-agent-shell-host-actions-types';

export function useAgentConversationHostActions(
  input: UseAgentConversationHostActionsInput,
): {
  handleSelectAgent: (agentHandle: string | null) => void;
  handleSubmit: (input: AgentConversationSubmitPayload) => Promise<void>;
  ensureConversationAnchor: () => Promise<string>;
} {
  useEffect(() => {
    if (!input.threadsReady) {
      return;
    }
    if (input.selectedAgentHandle && !input.targetByAgentHandle.has(input.selectedAgentHandle)) {
      input.syncSelectionToThread(null);
    }
  }, [input]);

  const sendPending = useRef(false);
  const submittingLockTokenRef = useRef(0);
  const draftScope = useMemo(() => ({ active: true }), [input.currentComposerTextRef]);
  const currentDraftScope = useRef(draftScope);
  currentDraftScope.current = draftScope;
  const attachmentDraft = useRef({ items: input.pendingAttachments, revision: 0 });
  const previousAttachments = attachmentDraft.current.items ?? [];
  const nextAttachments = input.pendingAttachments ?? [];
  if (previousAttachments.length !== nextAttachments.length
    || previousAttachments.some((item, index) => item !== nextAttachments[index])) attachmentDraft.current.revision++;
  attachmentDraft.current.items = input.pendingAttachments;
  useEffect(() => {
    draftScope.active = true;
    return () => { draftScope.active = false; };
  }, [draftScope]);

  const handleSelectAgent = useCallback((agentHandle: string | null) => {
    if (input.submittingThreadId) {
      return;
    }
    void (async () => {
      // Each partner keeps its own draft, so changing partner discards nothing.
      const normalizedAgentHandle = normalizeText(agentHandle);
      if (!normalizedAgentHandle) {
        input.syncSelectionToThread(null);
        return;
      }
      const target = input.targetByAgentHandle.get(normalizedAgentHandle);
      if (!target) {
        throw new Error(input.t('Chat.agentTargetMissing', {
          defaultValue: 'The selected agent friend is no longer available.',
        }));
      }
      input.setSelectionForAgentHandle(
        normalizeText(target.agentHandle),
        normalizeText(target.conversationAnchorId),
      );
    })().catch(input.reportHostError);
  }, [input]);

  const handleSubmit = useCallback(async (payload: AgentConversationSubmitPayload) => {
    const revision = input.currentComposerTextRef.revision;
    const attachmentRevision = attachmentDraft.current.revision;
    // Voice and image-retry submissions have no composer callback. They may
    // only fill an untouched empty draft in the same mounted owner scope.
    const startedEmpty = input.currentComposerTextRef.current === '' && (input.pendingAttachments?.length ?? 0) === 0;
    const canUpdateDraft = () => draftScope.active && currentDraftScope.current === draftScope
      && (payload.canUpdateDraft ? payload.canUpdateDraft()
        : startedEmpty && input.currentComposerTextRef.current === ''
          && input.currentComposerTextRef.revision === revision && attachmentDraft.current.revision === attachmentRevision);
    if(sendPending.current) throw new Error(input.t('Chat.agentSending'));
    sendPending.current=true;
    try { await submitAgentConversationTurn({
      hostInput: input,
      payload: { ...payload, canUpdateDraft },
      submittingLockTokenRef,
    }); } finally {sendPending.current=false;}
  }, [input, draftScope]);

  const ensureConversationAnchor = useCallback(async () => {
    if (!input.activeTarget) {
      throw new Error(input.t('Chat.agentSubmitMissingThread', {
        defaultValue: 'Select an agent friend before starting voice input.',
      }));
    }
    const ensured = await ensureThreadAnchorBindingForTarget({
      input,
      target: input.activeTarget,
      thread: input.activeThreadId && input.selectedThreadRecord
        ? input.selectedThreadRecord
        : null,
    });
    return ensured.anchorBinding.conversationAnchorId;
  }, [input]);

  return {
    handleSelectAgent,
    handleSubmit,
    ensureConversationAnchor,
  };
}
