import type { ZhiyuEvidence } from './evidence';

export type ZhiyuRuntimeChatApplyIdentity = Pick<
  ZhiyuEvidence['conversation'],
  'agentHandle' | 'conversationAnchorId' | 'threadId'
>;

export function zhiyuRuntimeChatApplyIdentity(
  conversation: ZhiyuRuntimeChatApplyIdentity,
): ZhiyuRuntimeChatApplyIdentity {
  return {
    agentHandle: normalizedText(conversation.agentHandle),
    conversationAnchorId: normalizedText(conversation.conversationAnchorId),
    threadId: normalizedText(conversation.threadId),
  };
}

export function shouldApplyZhiyuRuntimeChatUpdate(input: {
  readonly currentConversation: ZhiyuRuntimeChatApplyIdentity;
  readonly submittedConversation: ZhiyuRuntimeChatApplyIdentity;
}): boolean {
  const current = zhiyuRuntimeChatApplyIdentity(input.currentConversation);
  const submitted = zhiyuRuntimeChatApplyIdentity(input.submittedConversation);
  return Boolean(
    submitted.agentHandle
    && submitted.conversationAnchorId
    && submitted.threadId
    && current.agentHandle === submitted.agentHandle
    && current.conversationAnchorId === submitted.conversationAnchorId
    && current.threadId === submitted.threadId,
  );
}

export function shouldContinueZhiyuRuntimeChatSubmit(input: {
  readonly currentConversation: ZhiyuRuntimeChatApplyIdentity;
  readonly submittedConversation: ZhiyuRuntimeChatApplyIdentity;
  readonly signal?: Pick<AbortSignal, 'aborted'> | null;
}): boolean {
  return input.signal?.aborted !== true
    && shouldApplyZhiyuRuntimeChatUpdate({
      currentConversation: input.currentConversation,
      submittedConversation: input.submittedConversation,
    });
}

function normalizedText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}
