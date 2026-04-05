import type { ConversationThreadSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { resolveRealmMessageText } from '@nimiplatform/nimi-kit/features/chat/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { i18n, formatLocaleDate, formatRelativeLocaleTime } from '@renderer/i18n';
import { resolveCanonicalChatAttachmentPreviewText } from '@renderer/features/turns/chat-attachment-contract.js';

export type HumanChatViewDto = RealmModel<'ChatViewDto'>;

export function getHumanTargetId(chat: HumanChatViewDto): string {
  return String(chat.otherUser?.id || '').trim() || String(chat.id || '').trim();
}

export function getHumanChatTitle(chat: HumanChatViewDto): string {
  const displayName = String(chat.otherUser?.displayName || '').trim();
  const handle = String(chat.otherUser?.handle || '').trim();
  return displayName || handle || String(chat.id || i18n.t('Common.unknown', { defaultValue: 'Unknown' }));
}

export function getHumanChatPreview(
  chat: HumanChatViewDto,
  noMessagesFallback = i18n.t('Chat.noMessages', { defaultValue: 'No messages yet' }),
): string {
  const lastMsg = chat.lastMessage;
  if (lastMsg) {
    const resolvedText = resolveRealmMessageText(lastMsg).trim();
    if (resolvedText) {
      return resolvedText;
    }
    const attachmentText = resolveCanonicalChatAttachmentPreviewText(lastMsg.payload);
    if (attachmentText) {
      return attachmentText;
    }
  }
  return noMessagesFallback;
}

function resolveHumanChatSortTime(chat: HumanChatViewDto): number {
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

export function compareHumanChatsByRecency(left: HumanChatViewDto, right: HumanChatViewDto): number {
  const delta = resolveHumanChatSortTime(right) - resolveHumanChatSortTime(left);
  if (delta !== 0) {
    return delta;
  }
  return String(right.id || '').localeCompare(String(left.id || ''));
}

export function collapseHumanChatsToTargets(
  chats: readonly HumanChatViewDto[],
): HumanChatViewDto[] {
  const byTargetId = new Map<string, HumanChatViewDto>();
  for (const chat of [...chats].sort(compareHumanChatsByRecency)) {
    const targetId = getHumanTargetId(chat);
    if (!targetId || byTargetId.has(targetId)) {
      continue;
    }
    byTargetId.set(targetId, chat);
  }
  return [...byTargetId.values()];
}

export function resolveCanonicalHumanChatId(
  chats: readonly HumanChatViewDto[],
  targetId: string | null | undefined,
): string | null {
  const normalizedTargetId = String(targetId || '').trim();
  if (!normalizedTargetId) {
    return null;
  }
  const canonicalChat = collapseHumanChatsToTargets(chats)
    .find((chat) => getHumanTargetId(chat) === normalizedTargetId);
  return canonicalChat ? String(canonicalChat.id || '').trim() || null : null;
}

export function formatHumanChatTime(isoString: string | null | undefined): string {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) {
    return formatRelativeLocaleTime(date);
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return formatRelativeLocaleTime(date);
  }
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) {
    return formatLocaleDate(date, { weekday: 'short' });
  }
  return formatLocaleDate(date, { month: 'short', day: 'numeric' });
}

export function toHumanConversationThreadSummary(chat: HumanChatViewDto): ConversationThreadSummary {
  return {
    id: String(chat.id || ''),
    mode: 'human',
    title: getHumanChatTitle(chat),
    previewText: getHumanChatPreview(chat),
    createdAt: String(chat.createdAt || ''),
    updatedAt: formatHumanChatTime(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.createdAt),
    unreadCount: Number(chat.unreadCount || 0),
    status: 'active',
    targetId: getHumanTargetId(chat) || null,
    targetLabel: String(chat.otherUser?.displayName || chat.otherUser?.handle || '').trim() || null,
  };
}
