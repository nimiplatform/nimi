type GroupTriggerMessageEvidenceInput = {
  readonly chatId: unknown;
  readonly currentUserId: unknown;
  readonly triggerMessage: {
    readonly id?: unknown;
    readonly chatId?: unknown;
    readonly senderId?: unknown;
    readonly author?: {
      readonly accountId?: unknown;
    } | null;
  };
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function assertGroupTriggerMessageMatchesChat(
  input: GroupTriggerMessageEvidenceInput,
): string {
  const chatId = normalizeText(input.chatId);
  const currentUserId = normalizeText(input.currentUserId);
  const triggerMessageId = normalizeText(input.triggerMessage.id);
  const triggerChatId = normalizeText(input.triggerMessage.chatId);
  const senderId = normalizeText(input.triggerMessage.senderId);
  const authorAccountId = normalizeText(input.triggerMessage.author?.accountId);
  if (!triggerMessageId) {
    throw new Error('group source candidate handoff requires a committed Realm trigger message');
  }
  if (!chatId || triggerChatId !== chatId) {
    throw new Error('group source candidate handoff trigger message chatId must match the target group chat');
  }
  if (!currentUserId || senderId !== currentUserId || authorAccountId !== currentUserId) {
    throw new Error('group source candidate handoff trigger message author must match the authenticated actor');
  }
  return triggerMessageId;
}
