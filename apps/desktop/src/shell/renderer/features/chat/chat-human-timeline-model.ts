import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getRealmChatTimelineDisplayModel,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
  useRealmMessageTimeline,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useChatUploadPlaceholders } from '../turns/chat-upload-placeholder-context.js';
import type { StreamState } from '../turns/stream-controller';
import { useStreamController } from '../turns/stream-controller-context.js';
import { useRealmHumanChatData } from './data/realm-human-chat-data-context.js';

export type HumanRealmChatTimelineDisplay = ReturnType<typeof getRealmChatTimelineDisplayModel>;

function resolveAttachmentDisplayKind(payload: unknown): string {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const attachment = record?.attachment && typeof record.attachment === 'object' && !Array.isArray(record.attachment)
    ? record.attachment as Record<string, unknown>
    : null;
  const preview = attachment?.preview && typeof attachment.preview === 'object' && !Array.isArray(attachment.preview)
    ? attachment.preview as Record<string, unknown>
    : null;
  return String(preview?.displayKind || attachment?.displayKind || '').trim().toUpperCase();
}

function useHumanStreamState(chatId: string | null): StreamState | null {
  const streamController = useStreamController();
  const [state, setState] = useState<StreamState | null>(
    () => (chatId ? streamController.getStreamState(chatId) : null),
  );

  useEffect(() => {
    if (!chatId) {
      setState(null);
      return;
    }
    setState(streamController.getStreamState(chatId));
    return streamController.subscribeStream(chatId, (updated) => {
      setState({ ...updated });
    });
  }, [chatId, streamController]);

  return state;
}

export function useHumanTimelineModel(selectedChatId: string | null, selectedChat: RealmChatViewDto | null) {
  const realmHumanChatData = useRealmHumanChatData();
  const authStatus = useAppStore((state) => state.auth.status);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const currentUserAvatarUrl = typeof currentUser?.avatarUrl === 'string' ? currentUser.avatarUrl : null;
  const uploadPlaceholders = useChatUploadPlaceholders(selectedChatId);
  const streamState = useHumanStreamState(selectedChatId);
  const isStreaming = streamState?.phase === 'waiting' || streamState?.phase === 'streaming';
  const otherUser = selectedChat?.otherUser;
  const contactName = String(otherUser?.displayName || otherUser?.handle || 'Chat').trim();
  const contactAvatarUrl = otherUser?.avatarUrl || null;
  const messagesQuery = useQuery({
    queryKey: ['messages', selectedChatId],
    queryFn: async () => {
      if (!selectedChatId) {
        return null;
      }
      return await realmHumanChatData.loadChatMessages(selectedChatId, 50);
    },
    enabled: authStatus === 'authenticated' && Boolean(selectedChatId),
  });

  const timelineMessages = useRealmMessageTimeline({
    messagesData: messagesQuery.data,
    currentUserId,
    uploadPlaceholders,
  });

  const canonicalMessages: ConversationCanonicalMessage[] = useMemo(
    () => timelineMessages.map((message) => {
      const display = getRealmChatTimelineDisplayModel(message, currentUserId);
      const attachmentDisplayKind = resolveAttachmentDisplayKind(message.payload);
      const mediaUrl = display.isMediaMessage
        ? resolveRealmChatMediaUrl(message.payload, realmBaseUrl) || display.localPreviewUrl || null
        : null;
      const mediaLabel = display.isMediaMessage
        ? resolveRealmChatAttachmentPreviewText(message.payload)
        : '';
      return {
        id: String(message.id || message.clientMessageId || ''),
        sessionId: String(selectedChatId || ''),
        targetId: String(selectedChat?.otherUser?.id || selectedChatId),
        source: 'human' as const,
        role: display.isMe ? 'human' as const : 'assistant' as const,
        text: display.resolvedText || '',
        createdAt: String(message.createdAt || ''),
        updatedAt: String(message.editedAt || message.createdAt || ''),
        status: display.deliveryState === 'pending'
          ? 'pending' as const
          : display.deliveryState === 'failed'
            ? 'error' as const
            : 'complete' as const,
        error: display.deliveryError,
        kind: display.isGiftMessage
          ? 'gift' as const
          : attachmentDisplayKind === 'AUDIO'
            ? 'voice' as const
          : display.isImageMessage
            ? (display.isUploadingMedia ? 'image-pending' as const : 'image' as const)
            : display.isVideoMessage
              ? (display.isUploadingMedia ? 'video-pending' as const : 'video' as const)
              : 'text' as const,
        senderName: display.isMe ? 'You' : contactName,
        senderAvatarUrl: display.isMe ? currentUserAvatarUrl : contactAvatarUrl,
        senderHandle: display.isMe ? null : String(selectedChat?.otherUser?.handle || '').trim() || null,
        senderKind: 'human' as const,
        metadata: {
          realmMessage: message,
          display,
          mediaUrl,
          mediaLabel,
          voiceUrl: attachmentDisplayKind === 'AUDIO'
            ? resolveRealmChatMediaUrl(message.payload, realmBaseUrl) || display.localPreviewUrl || null
            : null,
          voiceTranscript: display.resolvedText || '',
          mediaWidth: (message as unknown as { width?: number }).width,
          mediaHeight: (message as unknown as { height?: number }).height,
        },
      };
    }),
    [contactAvatarUrl, contactName, currentUserAvatarUrl, currentUserId, realmBaseUrl, selectedChat?.otherUser?.handle, selectedChat?.otherUser?.id, selectedChatId, timelineMessages],
  );

  return {
    authStatus,
    selectedChatId,
    realmBaseUrl,
    currentUserId,
    currentUserAvatarUrl,
    contactName,
    contactAvatarUrl,
    messagesQuery,
    timelineMessages,
    canonicalMessages,
    streamState,
    isStreaming,
  };
}

export type HumanTimelineModel = ReturnType<typeof useHumanTimelineModel>;
