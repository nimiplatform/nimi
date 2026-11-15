export const ZHIYU_CONVERSATION_OPEN_EVENT = 'nimi:zhiyu:conversation-open:event';
export const ZHIYU_CONVERSATION_OPEN_READ = 'nimi:zhiyu:conversation-open:read';
export const ZHIYU_CONVERSATION_OPEN_ACK = 'nimi:zhiyu:conversation-open:ack';

export type ZhiyuConversationOpenTarget = Readonly<{
  conversationAnchorId: string;
  messageId?: string;
  text?: string;
}>;
export type ZhiyuConversationOpenRequest = ZhiyuConversationOpenTarget & { readonly requestId: string };

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.conversation-open
// Navigation correlation only. The destination resolves its own protected reference.
export function parseZhiyuConversationOpenTarget(value: unknown): ZhiyuConversationOpenTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation target.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['conversationAnchorId', 'messageId', 'text'].includes(key))) throw new Error('Unknown conversation target field.');
  const ref = (value: unknown) => {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid conversation reference.');
    return value;
  };
  const conversationAnchorId = ref(row.conversationAnchorId);
  if (row.text !== undefined && (typeof row.text !== 'string' || row.text.length > 16384)) throw new Error('Conversation draft is too large or invalid.');
  return { conversationAnchorId, ...(row.messageId === undefined ? {} : { messageId: ref(row.messageId) }), ...(row.text === undefined ? {} : { text: row.text as string }) };
}
