import type { ZhiyuEvidence } from './evidence';

export type ZhiyuRuntimeChatApplyIdentity = Pick<
  ZhiyuEvidence['conversation'],
  'ownerUserId' | 'runtimeSourceRef' | 'localAgentRef' | 'conversationAnchorId'
>;

export function zhiyuRuntimeChatApplyIdentity(
  conversation: ZhiyuRuntimeChatApplyIdentity,
): ZhiyuRuntimeChatApplyIdentity {
  return {
    ownerUserId: normalizedText(conversation.ownerUserId),
    runtimeSourceRef: normalizedText(conversation.runtimeSourceRef),
    localAgentRef: normalizedText(conversation.localAgentRef),
    conversationAnchorId: normalizedText(conversation.conversationAnchorId),
  };
}

export function shouldApplyZhiyuRuntimeChatUpdate(input: {
  readonly currentConversation: ZhiyuRuntimeChatApplyIdentity;
  readonly submittedConversation: ZhiyuRuntimeChatApplyIdentity;
}): boolean {
  const current = zhiyuRuntimeChatApplyIdentity(input.currentConversation);
  const submitted = zhiyuRuntimeChatApplyIdentity(input.submittedConversation);
  return Boolean(
    submitted.ownerUserId
    && submitted.runtimeSourceRef
    && submitted.localAgentRef
    && submitted.conversationAnchorId
    && current.ownerUserId === submitted.ownerUserId
    && current.runtimeSourceRef === submitted.runtimeSourceRef
    && current.localAgentRef === submitted.localAgentRef
    && current.conversationAnchorId === submitted.conversationAnchorId,
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
