import type {
  ConversationCanonicalMessage,
  ConversationTargetSummary,
  ConversationThreadSummary,
} from '@nimiplatform/kit/features/chat/headless';
import {
  normalizeRealmMessagePayload,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmMessageText,
  type RealmMessageViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';

export type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
export type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
export type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
export type GroupMessageAuthorDto = RealmModel<'GroupMessageAuthorDto'>;

type GroupMessageTextSource = {
  readonly text?: unknown;
  readonly payload?: unknown;
};

function projectGroupMessageTextSource(
  message: GroupMessageTextSource,
): Pick<RealmMessageViewDto, 'payload' | 'text'> {
  return {
    text: typeof message.text === 'string' || message.text === null ? message.text : undefined,
    payload: normalizeRealmMessagePayload(message.payload),
  };
}

export type GroupChatCopy = {
  readonly group: string;
  readonly noMessages: string;
  readonly members: string;
};

export function getGroupChatTitle(chat: GroupChatViewDto, groupFallback: string): string {
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
      .join(', ') || groupFallback;
  }
  return groupFallback;
}

export function getGroupChatPreview(
  chat: GroupChatViewDto,
  noMessagesFallback: string,
): string {
  const lastMsg = chat.lastMessage;
  if (lastMsg) {
    const source = projectGroupMessageTextSource(lastMsg);
    const resolvedText = resolveRealmMessageText(source).trim();
    if (resolvedText) return resolvedText;
    const attachmentText = resolveRealmChatAttachmentPreviewText(source.payload);
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

export function toGroupConversationThreadSummary(
  chat: GroupChatViewDto,
  copy: GroupChatCopy,
): ConversationThreadSummary {
  const title = getGroupChatTitle(chat, copy.group);
  return {
    id: String(chat.id || ''),
    mode: 'group',
    title,
    previewText: getGroupChatPreview(chat, copy.noMessages),
    createdAt: String(chat.createdAt || ''),
    updatedAt: String(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.createdAt || ''),
    unreadCount: Number(chat.unreadCount || 0),
    status: 'active',
    targetId: String(chat.id || ''),
    targetLabel: title,
  };
}

export function toGroupTargetSummary(
  chat: GroupChatViewDto,
  copy: GroupChatCopy,
): ConversationTargetSummary {
  const humanCount = getGroupParticipantCount(chat);
  const title = getGroupChatTitle(chat, copy.group);
  return {
    id: String(chat.id || ''),
    source: 'group' as const,
    canonicalSessionId: String(chat.id || ''),
    title,
    handle: `${humanCount} ${copy.members}`,
    bio: null,
    avatarUrl: null,
    avatarFallback: title.charAt(0).toUpperCase() || 'G',
    previewText: getGroupChatPreview(chat, copy.noMessages),
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
  const senderKind: 'human' | 'source' = author?.type === 'source' ? 'source' : 'human';
  const role = isCurrentUser
    ? 'user' as const
    : author?.type === 'source'
      ? 'assistant' as const
      : 'assistant' as const;

  let text = '';
  const rawText = String(msg.text || '').trim();
  if (rawText) {
    text = rawText;
  } else if (msg.payload) {
    text = resolveRealmMessageText(projectGroupMessageTextSource(msg));
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
      sourceOwnerId: author?.sourceAuthorityAccountId || null,
    },
  };
}
