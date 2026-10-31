import { isDeletedChatPeer } from './use-human-chat-list.js';
import { readMediaDelivery } from '@nimiplatform/kit/features/media/headless';
import { openExternalUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRealmChatTimelineDisplayModel,
  normalizeRealmMessagePayload,
  resolveRealmChatAttachmentPreviewText,
  resolveRealmChatMediaUrl,
  resolveTimelineAttachmentRecord,
  sameRealmChatTimelineIdentity,
  useRealmMessageTimeline,
  type RealmChatTimelineMessage,
  type RealmChatViewDto,
  type RealmMessageViewDto,
  type RealmListMessagesResultDto,
} from '@nimiplatform/kit/features/chat/realm';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useChatUploadPlaceholders } from '../turns/chat-upload-placeholder-context.js';
import type { StreamState } from '../turns/stream-controller';
import { useStreamController } from '../turns/stream-controller-context.js';
import { useRealmHumanChatData } from './data/realm-human-chat-data-context.js';
import type { PersistentOutboxEntry } from '../../infra/offline/types.js';

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

function toDesktopPendingTimelineMessage(
  entry: PersistentOutboxEntry,
  currentUserId: string,
): RealmChatTimelineMessage {
  const type = String(entry.body.type || 'TEXT').trim().toUpperCase();
  return {
    id: `offline:${entry.clientMessageId}`,
    chatId: entry.chatId,
    clientMessageId: entry.clientMessageId,
    createdAt: new Date(entry.enqueuedAt).toISOString(),
    isRead: true,
    payload: normalizeRealmMessagePayload(entry.body.payload),
    senderId:
      currentUserId ||
      (typeof entry.body.senderId === 'string' ? entry.body.senderId.trim() : '') ||
      'local-user',
    text: typeof entry.body.text === 'string' ? entry.body.text : null,
    type: type as RealmMessageViewDto['type'],
    deliveryState: entry.status === 'failed' ? 'failed' : 'pending',
    deliveryError: entry.failReason ?? null,
    localPreviewUrl: null,
    localUploadState: null,
  };
}

function timelineTimestamp(message: RealmMessageViewDto): number {
  const timestamp = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
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

// @nimi-authority: rule.nimi.desktop.product-surfaces.human-chat-consumption
export function useHumanTimelineModel(selectedChatId: string | null, selectedChat: RealmChatViewDto | null) {
  const realmHumanChatData = useRealmHumanChatData();
  const authStatus = useAppStore((state) => state.auth.status);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const realmEnvironmentId = String(currentUser?.realmEnvironmentId || '');
  const currentUserAvatarUrl = typeof currentUser?.avatarUrl === 'string' ? currentUser.avatarUrl : null;
  const uploadPlaceholders = useChatUploadPlaceholders(selectedChatId);
  const streamState = useHumanStreamState(selectedChatId);
  const isStreaming = streamState?.phase === 'waiting' || streamState?.phase === 'streaming';
  const otherUser = selectedChat?.otherUser;
  const deletedPeer = isDeletedChatPeer(otherUser);
  const contactName = String(otherUser?.displayName || otherUser?.handle || 'Chat').trim();
  const contactAvatarUrl = otherUser?.avatarUrl || null;
  const queryClient = useQueryClient();
  const messagePages = useInfiniteQuery({
    queryKey: ['messages', selectedChatId, realmEnvironmentId, currentUserId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<RealmListMessagesResultDto & { offlineOutbox?: PersistentOutboxEntry[] }> => {
      if (pageParam) {
        const page = await realmHumanChatData.loadMoreChatMessages(selectedChatId!, pageParam, 50);
        if (!page) throw new Error('Message page unavailable');
        return page;
      }
      return realmHumanChatData.loadChatMessages(selectedChatId!, 50);
    },
    getNextPageParam: page => page.nextBefore || undefined,
    enabled: authStatus === 'authenticated' && Boolean(selectedChatId),
  });
  const messageData = useMemo(() => {
    if (!messagePages.data) return undefined;
    const byId = new Map<string, RealmMessageViewDto>();
    for (const page of messagePages.data.pages) for (const item of page.items) if (!byId.has(item.id)) byId.set(item.id, item);
    return { items: [...byId.values()], offlineOutbox: messagePages.data.pages[0]?.offlineOutbox ?? [] };
  }, [messagePages.data]);
  const messagesQuery = { ...messagePages, data: messageData };
  // Realm pages arrive newest first. On equal timestamps keep their order,
  // without interpreting opaque IDs or including local sends and uploads.
  const newestMessage = useMemo(() => messageData?.items.reduce<RealmMessageViewDto | null>(
    (latest, message) => !latest || timelineTimestamp(message) > timelineTimestamp(latest) ? message : latest,
    null,
  ) ?? null, [messageData]);
  const readPosition = useRef<{ message: RealmMessageViewDto; failed: boolean } | null>(null);
  const readScope = JSON.stringify([realmBaseUrl, realmEnvironmentId, currentUserId, selectedChatId]);
  const readTarget = useRef({ scope: readScope, newestMessage });
  readTarget.current = { scope: readScope, newestMessage };
  const [readError, setReadError] = useState<string | null>(null);
  useEffect(() => { readPosition.current = null; setReadError(null); }, [readScope]);
  const acknowledgeRead = useCallback(async (messageId: string) => {
    if (!selectedChatId || readTarget.current.scope !== readScope || document.visibilityState !== 'visible') return;
    const previous = readPosition.current;
    const retry = previous?.failed && previous.message.id === messageId;
    const message = retry ? previous.message : readTarget.current.newestMessage;
    if (!message || message.id !== messageId) return;
    if (previous && !retry) {
      if (previous.message.id === messageId || timelineTimestamp(message) < timelineTimestamp(previous.message)) return;
    }
    const attempt = { message, failed: false };
    readPosition.current = attempt;
    setReadError(null);
    try {
      await realmHumanChatData.markChatAsRead(selectedChatId, messageId);
      if (readTarget.current.scope !== readScope) return;
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch {
      if (readTarget.current.scope === readScope && readPosition.current === attempt) {
        attempt.failed = true;
        setReadError(messageId);
      }
    }
  }, [selectedChatId, realmHumanChatData, queryClient, readScope]);

  const confirmedTimelineMessages = useRealmMessageTimeline({
    messagesData: messagesQuery.data,
    uploadPlaceholders,
  });
  const timelineMessages = useMemo(() => {
    const merged = [...confirmedTimelineMessages];
    const pendingEntries = Array.isArray(messagesQuery.data?.offlineOutbox)
      ? messagesQuery.data.offlineOutbox
      : [];
    for (const entry of pendingEntries) {
      if (entry.body.uploadNeeded === true) continue;
      const pending = toDesktopPendingTimelineMessage(entry, currentUserId);
      if (!merged.some((message) => sameRealmChatTimelineIdentity(message, pending))) {
        merged.push(pending);
      }
    }
    merged.sort((left, right) => {
      const timeDiff = timelineTimestamp(left) - timelineTimestamp(right);
      return timeDiff !== 0
        ? timeDiff
        : String(left.clientMessageId || left.id || '').localeCompare(
            String(right.clientMessageId || right.id || ''),
          );
    });
    return merged;
  }, [confirmedTimelineMessages, currentUserId, messagesQuery.data]);

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
        kind: attachmentDisplayKind === 'AUDIO'
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
          mediaDelivery: readMediaDelivery(resolveTimelineAttachmentRecord(message.payload)?.delivery),
          refreshMedia: () => realmHumanChatData.refreshMessageMedia(String(selectedChatId), String(message.id)),
          openMediaOriginal: openExternalUrl,
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
    [contactAvatarUrl, contactName, currentUserAvatarUrl, currentUserId, realmBaseUrl, selectedChat?.otherUser?.handle, selectedChat?.otherUser?.id, selectedChatId, timelineMessages, realmHumanChatData],
  );

  return {
    authStatus,
    selectedChatId,
    realmBaseUrl,
    currentUserId,
    currentUserAvatarUrl,
    contactName,
    deletedPeer,
    contactAvatarUrl,
    messagesQuery,
    timelineMessages,
    canonicalMessages,
    streamState,
    isStreaming,
    acknowledgeRead,
    readError,
    newestMessageId: newestMessage?.id ?? null,
    hasOlderMessages: messagePages.hasNextPage,
    loadingOlderMessages: messagePages.isFetchingNextPage,
    olderMessagesError: messagePages.isFetchNextPageError,
    loadOlderMessages: () => messagePages.fetchNextPage(),
  };
}

export type HumanTimelineModel = ReturnType<typeof useHumanTimelineModel>;
