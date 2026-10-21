import type { AppStoreState } from '../../app-shell/providers/store-types';
import type { PendingAttachment } from '../turns/turn-input-attachments.js';

type AttachmentDraftStore = {
  getState: () => Pick<AppStoreState, 'agentComposerAttachments' | 'setAgentComposerAttachments'>;
};

/** Capture the exact in-memory Files before Send, including unknown receipts. */
export function bindAgentComposerAttachments(
  store: AttachmentDraftStore, accountId: string, threadId: string,
  requestId: string, submitted: readonly PendingAttachment[],
) {
  const key = agentComposerDraftKey(accountId, threadId);
  if (!key || !requestId || submitted.length === 0) return;
  const state = store.getState();
  const urls = new Set(submitted.map(item => item.previewUrl));
  const current = state.agentComposerAttachments[key] ?? [];
  if (current.some(item => urls.has(item.previewUrl))) state.setAgentComposerAttachments(accountId, threadId,
    current.map(item => urls.has(item.previewUrl) ? { ...item, submissionRequestId: requestId } : item));
}

/** Both direct and recovered admission consume only their original Files. */
export function acknowledgeAgentComposerAttachments(
  store: AttachmentDraftStore,
  accountId: string, threadId: string, requestId: string,
) {
  const key = agentComposerDraftKey(accountId, threadId);
  if (!key || !requestId) return;
  const state = store.getState();
  const current = state.agentComposerAttachments[key] ?? [];
  const remaining = current.filter(item => item.submissionRequestId !== requestId);
  if (remaining.length !== current.length) state.setAgentComposerAttachments(accountId, threadId, remaining);
}

/** A draft belongs to one account and one partner; without either there is none. */
export function agentComposerDraftKey(accountId: string, agentHandle: string): string | null {
  const account = accountId.trim();
  const handle = agentHandle.trim();
  return account && handle ? `${account}\u0000${handle}` : null;
}

type AgentComposerDraftStore = {
  getState: () => Pick<AppStoreState, 'agentComposerDrafts' | 'setAgentComposerDraft'>;
};

/**
 * A ref-shaped view of one partner's draft. Reads and writes always address
 * the account and partner it was created for, so a late write from a turn
 * started with partner A never lands in partner B's composer.
 */
export function createAgentComposerDraftRef(
  store: AgentComposerDraftStore,
  accountId: string,
  agentHandle: string,
): { current: string; readonly revision: number } {
  const key = agentComposerDraftKey(accountId, agentHandle);
  let revision = 0;
  return {
    get revision() { return revision; },
    get current() {
      return key ? store.getState().agentComposerDrafts[key] ?? '' : '';
    },
    set current(text: string) {
      if (key) {
        if ((store.getState().agentComposerDrafts[key] ?? '') !== text) revision++;
        store.getState().setAgentComposerDraft(accountId, agentHandle, text);
      }
    },
  };
}
