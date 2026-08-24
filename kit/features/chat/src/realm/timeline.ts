import { useMemo } from 'react';
import type { RealmMessageViewDto } from './codec.js';
import type {
  RealmChatTimelineMessage,
  RealmChatUploadPlaceholderLike,
  UseRealmMessageTimelineOptions,
} from './types.js';

function resolveTimelineMessageTimestamp(message: RealmChatTimelineMessage): number {
  const timestamp = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function toRealmChatTimelineRemoteMessage(
  message: RealmMessageViewDto,
): RealmChatTimelineMessage {
  return {
    ...message,
    deliveryState: 'sent',
    deliveryError: null,
    localPreviewUrl: null,
    localUploadState: null,
  };
}

export function toRealmChatTimelineUploadPlaceholder(
  placeholder: RealmChatUploadPlaceholderLike,
): RealmChatTimelineMessage {
  return {
    id: `upload:${placeholder.id}`,
    chatId: placeholder.chatId,
    clientMessageId: `upload:${placeholder.id}`,
    createdAt: placeholder.createdAt,
    isRead: true,
    payload: {
      attachment: {
        targetType: 'RESOURCE',
        targetId: '',
        displayKind: placeholder.kind === 'image' ? 'IMAGE' : 'VIDEO',
        url: placeholder.previewUrl,
      },
    },
    senderId: placeholder.senderId,
    text: null,
    type: 'ATTACHMENT' as RealmMessageViewDto['type'],
    deliveryState: 'pending',
    deliveryError: null,
    localPreviewUrl: placeholder.previewUrl,
    localUploadState: 'uploading',
  };
}

export function useRealmMessageTimeline({
  messagesData,
  uploadPlaceholders = [],
}: UseRealmMessageTimelineOptions): readonly RealmChatTimelineMessage[] {
  return useMemo(() => {
    const remoteItems = (Array.isArray(messagesData?.items) ? messagesData.items : [])
      .map((message) => toRealmChatTimelineRemoteMessage(message));
    const merged: RealmChatTimelineMessage[] = remoteItems.slice();
    for (const placeholder of uploadPlaceholders) {
      merged.push(toRealmChatTimelineUploadPlaceholder(placeholder));
    }
    merged.sort((left, right) => {
      const timeDiff = resolveTimelineMessageTimestamp(left) - resolveTimelineMessageTimestamp(right);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return String(left.clientMessageId || left.id || '').localeCompare(String(right.clientMessageId || right.id || ''));
    });
    return merged;
  }, [messagesData, uploadPlaceholders]);
}
