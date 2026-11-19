import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';
import type { HumanChatNotice } from '../../../shared/human-chat-notice.js';

type ChatPosition = {
  readonly messageId: string | null;
  readonly createdAt: number;
  readonly unreadCount: number;
};

function positionOf(row: RealmChatViewDto): ChatPosition {
  return {
    messageId: row.lastMessage?.id ?? null,
    createdAt: Date.parse(row.lastMessage?.createdAt ?? ''),
    unreadCount: row.unreadCount,
  };
}

function unreadSender(row: RealmChatViewDto): string | null {
  const message = row.lastMessage;
  if (!message || row.unreadCount === 0 || message.isRead || message.senderId !== row.otherUser.id
    || message.type === 'RECALL' || message.type === 'SYSTEM' || message.type === 'FRIEND_REQUEST') return null;
  // eslint-disable-next-line no-control-regex -- Replace NUL and line breaks before displaying the sender.
  return (row.otherUser.displayName || row.otherUser.handle || '').replace(/[\r\n\u0000]+/gu, ' ').trim().slice(0, 120) || null;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.human-chat-notice
export function createHumanChatNoticeTracker() {
  const positions = new Map<string, ChatPosition>();
  let initialized = false;
  return {
    refresh(rows: readonly RealmChatViewDto[]): HumanChatNotice | null {
      let hasNewUnread = false;
      for (const row of rows) {
        const previous = positions.get(row.id);
        const current = positionOf(row);
        if (initialized && current.unreadCount > 0 && (!previous
          || current.unreadCount > previous.unreadCount
          || (unreadSender(row) && current.messageId !== previous.messageId && current.createdAt >= previous.createdAt))) hasNewUnread = true;
        positions.set(row.id, current);
      }
      initialized = true;
      return hasNewUnread ? { kind: 'summary' } : null;
    },
    change(row: RealmChatViewDto): HumanChatNotice | null {
      const previous = positions.get(row.id);
      const current = positionOf(row);
      positions.set(row.id, current);
      if (!initialized) {
        initialized = true;
        return null;
      }
      if (current.messageId === previous?.messageId || (previous && current.createdAt < previous.createdAt)) return null;
      const sender = unreadSender(row);
      if (!sender) return null;
      const kind = previous?.messageId && current.createdAt > previous.createdAt ? 'arrival' : 'unread';
      return { kind, chatId: row.id, sender };
    },
  };
}
