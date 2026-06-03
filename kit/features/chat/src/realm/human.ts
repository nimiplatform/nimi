import type {
  ConversationTargetSummary,
  ConversationThreadSummary,
} from '../types.js';
import {
  resolveRealmChatAttachmentPreviewText,
  resolveRealmMessageText,
} from './attachments.js';
import type { RealmChatViewDto } from './types.js';

export type RealmHumanChatUpdatedAtFormatterInput = {
  chat: RealmChatViewDto;
  timestamp: string;
};

export type RealmHumanChatProjectionOptions = {
  noMessagesFallback?: string;
  unknownTitle?: string;
  formatUpdatedAt?: (input: RealmHumanChatUpdatedAtFormatterInput) => string;
};

export function isRealmDirectHumanChat(chat: unknown): chat is RealmChatViewDto {
  if (!chat || typeof chat !== 'object') {
    return false;
  }
  const otherUser = (chat as { otherUser?: unknown }).otherUser;
  if (!otherUser || typeof otherUser !== 'object') {
    return false;
  }
  return (otherUser as { isAgent?: unknown }).isAgent === false;
}

export function filterRealmDirectHumanChats(items: readonly unknown[] | null | undefined): RealmChatViewDto[] {
  return Array.isArray(items) ? items.filter((item) => isRealmDirectHumanChat(item)) : [];
}

export function getRealmHumanTargetId(chat: RealmChatViewDto): string {
  return String(chat.otherUser?.id || '').trim() || String(chat.id || '').trim();
}

export function getRealmHumanChatTitle(
  chat: RealmChatViewDto,
  unknownTitle = 'Unknown',
): string {
  const displayName = String(chat.otherUser?.displayName || '').trim();
  const handle = String(chat.otherUser?.handle || '').trim();
  return displayName || handle || String(chat.id || unknownTitle);
}

export function getRealmHumanChatPreview(
  chat: RealmChatViewDto,
  noMessagesFallback = 'No messages yet',
): string {
  const lastMessage = chat.lastMessage;
  if (lastMessage) {
    const resolvedText = resolveRealmMessageText(lastMessage).trim();
    if (resolvedText) {
      return resolvedText;
    }
    const attachmentText = resolveRealmChatAttachmentPreviewText(lastMessage.payload);
    if (attachmentText) {
      return attachmentText;
    }
  }
  return noMessagesFallback;
}

function resolveRealmHumanChatSortTime(chat: RealmChatViewDto): number {
  const primary = Date.parse(String(chat.lastMessageAt || ''));
  if (Number.isFinite(primary)) {
    return primary;
  }

  const messageTime = Date.parse(String(chat.lastMessage?.createdAt || ''));
  if (Number.isFinite(messageTime)) {
    return messageTime;
  }

  const createdAt = Date.parse(String(chat.createdAt || ''));
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }

  return 0;
}

export function compareRealmHumanChatsByRecency(
  left: RealmChatViewDto,
  right: RealmChatViewDto,
): number {
  const delta = resolveRealmHumanChatSortTime(right) - resolveRealmHumanChatSortTime(left);
  if (delta !== 0) {
    return delta;
  }
  return String(right.id || '').localeCompare(String(left.id || ''));
}

export function collapseRealmHumanChatsToTargets(
  chats: readonly RealmChatViewDto[],
): RealmChatViewDto[] {
  const byTargetId = new Map<string, RealmChatViewDto>();
  for (const chat of [...chats].sort(compareRealmHumanChatsByRecency)) {
    const targetId = getRealmHumanTargetId(chat);
    if (!targetId || byTargetId.has(targetId)) {
      continue;
    }
    byTargetId.set(targetId, chat);
  }
  return [...byTargetId.values()];
}

export function resolveCanonicalRealmHumanChatId(
  chats: readonly RealmChatViewDto[],
  targetId: string | null | undefined,
): string | null {
  const normalizedTargetId = String(targetId || '').trim();
  if (!normalizedTargetId) {
    return null;
  }
  const canonicalChat = collapseRealmHumanChatsToTargets(chats)
    .find((chat) => getRealmHumanTargetId(chat) === normalizedTargetId);
  return canonicalChat ? String(canonicalChat.id || '').trim() || null : null;
}

function resolveRealmHumanChatTimestamp(chat: RealmChatViewDto): string {
  return String(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.createdAt || '');
}

export function toRealmHumanTargetSummary(
  chat: RealmChatViewDto,
  options: RealmHumanChatProjectionOptions = {},
): ConversationTargetSummary {
  const title = getRealmHumanChatTitle(chat, options.unknownTitle);
  const targetId = getRealmHumanTargetId(chat);
  const handle = String(chat.otherUser?.handle || '').trim();
  return {
    id: targetId,
    source: 'human',
    canonicalSessionId: String(chat.id || ''),
    title,
    handle: handle ? `@${handle}` : null,
    bio: null,
    avatarUrl: String(chat.otherUser?.avatarUrl || '').trim() || null,
    avatarFallback: title.charAt(0).toUpperCase() || 'H',
    previewText: getRealmHumanChatPreview(chat, options.noMessagesFallback),
    updatedAt: resolveRealmHumanChatTimestamp(chat),
    unreadCount: Number(chat.unreadCount || 0),
    status: 'active',
    isOnline: null,
    metadata: {
      otherUserId: targetId,
    },
  };
}

export function toRealmHumanConversationThreadSummary(
  chat: RealmChatViewDto,
  options: RealmHumanChatProjectionOptions = {},
): ConversationThreadSummary {
  const timestamp = resolveRealmHumanChatTimestamp(chat);
  return {
    id: String(chat.id || ''),
    mode: 'human',
    title: getRealmHumanChatTitle(chat, options.unknownTitle),
    previewText: getRealmHumanChatPreview(chat, options.noMessagesFallback),
    createdAt: String(chat.createdAt || ''),
    updatedAt: options.formatUpdatedAt
      ? options.formatUpdatedAt({ chat, timestamp })
      : timestamp,
    unreadCount: Number(chat.unreadCount || 0),
    status: 'active',
    targetId: getRealmHumanTargetId(chat) || null,
    targetLabel: String(chat.otherUser?.displayName || chat.otherUser?.handle || '').trim() || null,
  };
}
