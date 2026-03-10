import type { MessageType, MessageViewDto } from '@nimiplatform/sdk/realm';
import type { PersistentOutboxEntry } from '@runtime/offline';

export type ChatTimelineMessage = MessageViewDto & {
  deliveryState: 'sent' | 'pending' | 'failed';
  deliveryError?: string | null;
};

export function toChatTimelineRemoteMessage(message: MessageViewDto): ChatTimelineMessage {
  return {
    ...message,
    deliveryState: 'sent',
    deliveryError: null,
  };
}

export function toChatTimelineOutboxMessage(
  entry: PersistentOutboxEntry,
  fallbackSenderId: string,
): ChatTimelineMessage {
  const body = entry.body && typeof entry.body === 'object'
    ? entry.body as Record<string, unknown>
    : {};
  const payload = body.payload && typeof body.payload === 'object'
    ? body.payload as Record<string, unknown>
    : undefined;
  const type = String(body.type || 'TEXT').trim().toUpperCase() || 'TEXT';
  return {
    id: `offline:${entry.clientMessageId}`,
    chatId: entry.chatId,
    clientMessageId: entry.clientMessageId,
    createdAt: new Date(entry.enqueuedAt).toISOString(),
    isRead: true,
    payload: payload || null,
    senderId: fallbackSenderId || String(body.senderId || 'local-user'),
    text: typeof body.text === 'string' ? body.text : null,
    type: type as MessageType,
    deliveryState: entry.status,
    deliveryError: entry.failReason || null,
  };
}

export function sameChatTimelineIdentity(
  left: Pick<MessageViewDto, 'id' | 'clientMessageId'>,
  right: Pick<MessageViewDto, 'id' | 'clientMessageId'>,
): boolean {
  if (String(left.id || '') === String(right.id || '')) {
    return true;
  }
  const leftClientMessageId = String(left.clientMessageId || '').trim();
  const rightClientMessageId = String(right.clientMessageId || '').trim();
  return Boolean(leftClientMessageId && rightClientMessageId && leftClientMessageId === rightClientMessageId);
}
