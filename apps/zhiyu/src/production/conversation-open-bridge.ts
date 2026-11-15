import type { NimiAppRuntimeClient, NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { parseZhiyuConversationOpenTarget, type ZhiyuConversationOpenRequest } from '../shell/app/conversation-open.js';

declare global {
  interface Window {
    readonly __nimiZhiyuConversationOpen?: {
      subscribe(listener: (value: unknown) => void): () => void;
      acknowledge(value: { requestId: string; status: 'opened' | 'failed' }): void;
    };
  }
}

export function subscribeZhiyuConversationOpen(listener: (request: ZhiyuConversationOpenRequest | null) => void) {
  return window.__nimiZhiyuConversationOpen?.subscribe(value => {
    if (value === null) { listener(null); return; }
    if (!value || typeof value !== 'object') return;
    const { requestId, ...target } = value as Record<string, unknown>;
    if (typeof requestId !== 'string' || !requestId.startsWith('conversation-open-')) return;
    try { listener({ requestId, ...parseZhiyuConversationOpenTarget(target) }); }
    catch { acknowledgeZhiyuConversationOpen({ requestId, status: 'failed' }); }
  }) ?? (() => undefined);
}
export function acknowledgeZhiyuConversationOpen(value: { requestId: string; status: 'opened' | 'failed' }) {
  window.__nimiZhiyuConversationOpen?.acknowledge(value);
}

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.conversation-open
export async function resolveZhiyuConversationOpen(client: NimiAppRuntimeClient, request: ZhiyuConversationOpenRequest, isCurrent: () => boolean) {
  const references = await client.agents.listReferences();
  for (const reference of references) {
    if (!isCurrent()) throw new Error('Conversation opening superseded.');
    try {
      const snapshot = await client.conversation.snapshot({ agentHandle: reference.agentHandle, conversationAnchorId: request.conversationAnchorId });
      if (!isCurrent()) throw new Error('Conversation opening superseded.');
      if (snapshot.conversationAnchorId !== request.conversationAnchorId) continue;
      if (request.messageId) await client.conversation.readMessage({ agentHandle: reference.agentHandle, conversationAnchorId: request.conversationAnchorId, messageId: request.messageId });
      if (!isCurrent()) throw new Error('Conversation opening superseded.');
      return { agentHandle: reference.agentHandle as NimiLocalAppAgentHandle, conversationAnchorId: snapshot.conversationAnchorId };
    } catch (error) {
      const reason = extractNimiErrorFields(error).reasonCode;
      if (!['LOCAL_APP_RECORD_NOT_FOUND', 'LOCAL_APP_ACCESS_DENIED', 'SDK_LOCAL_APP_AGENT_SELECTOR_MISMATCH', 'local-app-agent-selector-mismatch', 'runtime-access-denied'].includes(reason ?? '')) throw error;
    }
  }
  throw new Error('This conversation is unavailable in the current account.');
}
