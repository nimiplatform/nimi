import { useCallback } from 'react';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { agentComposerDraftKey, bindAgentComposerAttachments, acknowledgeAgentComposerAttachments } from './chat-agent-composer-draft.js';
import type { PendingAttachment } from '../turns/turn-input-attachments.js';

// Pending Files stay in the existing shell store across management navigation.
// They are account/Conversation scoped and never persisted to disk.
export function useAgentConversationPendingAttachments(accountId: string, activeThreadId: string | null) {
  const store = useAppStoreApi();
  const drafts = useAppStore(state => state.agentComposerAttachments);
  const setAttachments = useAppStore(state => state.setAgentComposerAttachments);
  const key = agentComposerDraftKey(accountId, activeThreadId ?? '');
  const setPendingAttachmentsForThread = useCallback((threadId: string | null, next: readonly PendingAttachment[]) => {
    if (threadId) setAttachments(accountId, threadId, next);
  }, [accountId, setAttachments]);
  const bindAttachments = useCallback((requestId: string, submitted: readonly PendingAttachment[]) => {
    if (activeThreadId) bindAgentComposerAttachments(store, accountId, activeThreadId, requestId, submitted);
  }, [store, accountId, activeThreadId]);
  const acknowledgeAttachments = useCallback((requestId: string) => {
    if (activeThreadId) acknowledgeAgentComposerAttachments(store, accountId, activeThreadId, requestId);
  }, [store, accountId, activeThreadId]);
  return { activePendingAttachments: key ? drafts[key] ?? [] : [], setPendingAttachmentsForThread, bindAttachments, acknowledgeAttachments };
}
