import type {
  ConversationCanonicalMessage,
  ConversationTargetSummary,
  ConversationThreadSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { resolveRealmMessageText } from '@nimiplatform/nimi-kit/features/chat/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { i18n } from '@renderer/i18n';
import { resolveCanonicalChatAttachmentPreviewText } from '@renderer/features/turns/chat-attachment-contract.js';

export type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
export type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
export type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
export type GroupMessageAuthorDto = RealmModel<'GroupMessageAuthorDto'>;

export function getGroupChatTitle(chat: GroupChatViewDto): string {
  const title = String(chat.title || '').trim();
  if (title) return title;
  const humanParticipants = (chat.participants || []).filter(
    (p) => p.type === 'human',
  );
  if (humanParticipants.length > 0) {
    return humanParticipants
      .slice(0, 3)
      .map((p) => String(p.displayName || '').trim() || String(p.handle || '').trim())
      .filter(Boolean)
      .join(', ') || i18n.t('Chat.group', { defaultValue: 'Group' });
  }
  return i18n.t('Chat.group', { defaultValue: 'Group' });
}

export function getGroupChatPreview(
  chat: GroupChatViewDto,
  noMessagesFallback = i18n.t('Chat.noMessages', { defaultValue: 'No messages yet' }),
): string {
  const lastMsg = chat.lastMessage;
  if (lastMsg) {
    const resolvedText = resolveRealmMessageText(lastMsg).trim();
    if (resolvedText) return resolvedText;
    const attachmentText = resolveCanonicalChatAttachmentPreviewText(lastMsg.payload);
    if (attachmentText) return attachmentText;
  }
  return noMessagesFallback;
}

function resolveGroupChatSortTime(chat: GroupChatViewDto): number {
  const primary = Date.parse(String(chat.lastMessageAt || ''));
  if (Number.isFinite(primary)) return primary;
  const messageTime = Date.parse(String(chat.lastMessage?.createdAt || ''));
  if (Number.isFinite(messageTime)) return messageTime;
  const createdAt = Date.parse(String(chat.createdAt || ''));
  if (Number.isFinite(createdAt)) return createdAt;
  return 0;
}

export function compareGroupChatsByRecency(left: GroupChatViewDto, right: GroupChatViewDto): number {
  const delta = resolveGroupChatSortTime(right) - resolveGroupChatSortTime(left);
  if (delta !== 0) return delta;
  return String(right.id || '').localeCompare(String(left.id || ''));
}

export function getGroupParticipantCount(chat: GroupChatViewDto): number {
  return (chat.participants || []).filter((p) => p.type === 'human').length;
}

export function toGroupConversationThreadSummary(chat: GroupChatViewDto): ConversationThreadSummary {
  return {
    id: String(chat.id || ''),
    mode: 'group',
    title: getGroupChatTitle(chat),
    previewText: getGroupChatPreview(chat),
    createdAt: String(chat.createdAt || ''),
    updatedAt: String(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.createdAt || ''),
    unreadCount: Number(chat.unreadCount || 0),
    status: 'active',
    targetId: String(chat.id || ''),
    targetLabel: getGroupChatTitle(chat),
  };
}

export function toGroupTargetSummary(chat: GroupChatViewDto): ConversationTargetSummary {
  const humanCount = getGroupParticipantCount(chat);
  return {
    id: String(chat.id || ''),
    source: 'group' as const,
    canonicalSessionId: String(chat.id || ''),
    title: getGroupChatTitle(chat),
    handle: `${humanCount} ${i18n.t('Chat.groupMembers', { defaultValue: 'members' })}`,
    bio: null,
    avatarUrl: null,
    avatarFallback: getGroupChatTitle(chat).charAt(0).toUpperCase() || 'G',
    previewText: getGroupChatPreview(chat),
    updatedAt: String(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.createdAt || ''),
    unreadCount: Number(chat.unreadCount || 0),
    status: 'active' as const,
    isOnline: null,
    metadata: {
      participantCount: humanCount,
      type: 'GROUP',
    },
  };
}

export function groupMessageToCanonical(
  msg: GroupMessageViewDto,
  currentUserId: string | null,
): ConversationCanonicalMessage {
  const author = msg.author;
  const isCurrentUser = Boolean(currentUserId && author?.accountId === currentUserId);
  const senderKind: 'human' | 'agent' = author?.type === 'agent' ? 'agent' : 'human';
  const role = isCurrentUser
    ? 'user' as const
    : author?.type === 'agent'
      ? 'agent' as const
      : 'assistant' as const;

  let text = '';
  const rawText = String(msg.text || '').trim();
  if (rawText) {
    text = rawText;
  } else if (msg.payload) {
    text = resolveRealmMessageText(msg as unknown as Parameters<typeof resolveRealmMessageText>[0]);
  }

  return {
    id: String(msg.id || ''),
    sessionId: String(msg.chatId || ''),
    targetId: String(msg.chatId || ''),
    source: 'group' as const,
    role,
    text,
    createdAt: String(msg.createdAt || ''),
    updatedAt: msg.editedAt ? String(msg.editedAt) : undefined,
    status: 'complete',
    kind: 'text',
    senderName: author ? String(author.displayName || '').trim() || null : null,
    senderAvatarUrl: author?.avatarUrl || null,
    senderHandle: null,
    senderKind,
    metadata: {
      senderId: String(msg.senderId || ''),
      authorAccountId: author?.accountId || null,
      authorType: author?.type || null,
      agentOwnerId: author?.agentOwnerId || null,
    },
  };
}
