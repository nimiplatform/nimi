import { useMemo } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import type {
  RealmChatEventEnvelope,
  RealmChatSyncResultDto,
  RealmChatViewDto,
  RealmListChatsResultDto,
  RealmListMessagesResultDto,
  RealmMessageViewDto,
  RealmChatRealtimeSocket,
} from '@nimiplatform/nimi-kit/features/chat/realm';
import {
  applyRealmRealtimeMessageToChatsResult,
  applyRealmRealtimeMessageUpdateToChatsResult,
  applyRealmRealtimeMessageUpdateToMessagesResult,
  extractRealmMessageFromEvent,
  mergeRealmRealtimeMessageIntoMessagesResult,
  rememberRealmChatSeenEvent,
  useRealmChatRealtimeController,
} from '@nimiplatform/nimi-kit/features/chat/realm';
import { dataSync } from '@runtime/data-sync';
import { getOfflineCoordinator } from '@runtime/offline';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { invalidateNotificationQueries } from '@renderer/features/notification/notification-query.js';
import { resolveRealtimeUrl } from './resolve-realtime-url';

const CHAT_SOCKET_PATH = '/socket.io/';

type ApplyChatEventInput = {
  event: RealmChatEventEnvelope;
  selectedChatId: string | null;
  currentUserId: string;
};

function hasMessageQuery(chatId: string): boolean {
  return queryClient.getQueryState(['messages', chatId]) !== undefined;
}

function mergeChatQueriesByMessage(input: {
  message: RealmMessageViewDto;
  selectedChatId: string | null;
  currentUserId: string;
}): { found: boolean; shouldMarkRead: boolean } {
  const queries = queryClient.getQueriesData<RealmListChatsResultDto>({
    queryKey: ['chats'],
  });
  if (queries.length === 0) {
    return { found: false, shouldMarkRead: false };
  }

  let found = false;
  let shouldMarkRead = false;

  for (const [queryKey, current] of queries) {
    const result = applyRealmRealtimeMessageToChatsResult({
      current,
      message: input.message,
      currentUserId: input.currentUserId,
      selectedChatId: input.selectedChatId,
    });
    found = found || result.found;
    shouldMarkRead = shouldMarkRead || result.shouldMarkRead;
    queryClient.setQueryData(queryKey as QueryKey, result.data);
  }

  return { found, shouldMarkRead };
}

function mergeChatQueriesByUpdate(input: {
  chatId: string;
  message: RealmMessageViewDto;
}): boolean {
  const queries = queryClient.getQueriesData<RealmListChatsResultDto>({
    queryKey: ['chats'],
  });
  if (queries.length === 0) {
    return false;
  }

  let found = false;
  for (const [queryKey, current] of queries) {
    const result = applyRealmRealtimeMessageUpdateToChatsResult({
      current,
      chatId: input.chatId,
      message: input.message,
    });
    found = found || result.found;
    queryClient.setQueryData(queryKey as QueryKey, result.data);
  }
  return found;
}

function mergeMessageQueryByIncomingMessage(input: {
  message: RealmMessageViewDto;
  selectedChatId: string | null;
}): void {
  const shouldWriteMessageCache =
    input.selectedChatId === input.message.chatId
    || hasMessageQuery(input.message.chatId);
  if (!shouldWriteMessageCache) {
    return;
  }

  queryClient.setQueryData<RealmListMessagesResultDto>(
    ['messages', input.message.chatId],
    (current) => mergeRealmRealtimeMessageIntoMessagesResult(current, input.message),
  );
}

function mergeMessageQueryByUpdate(input: {
  chatId: string;
  message: RealmMessageViewDto;
  selectedChatId: string | null;
}): void {
  const shouldPatchMessageCache =
    input.selectedChatId === input.chatId
    || hasMessageQuery(input.chatId);
  if (!shouldPatchMessageCache) {
    return;
  }

  queryClient.setQueryData<RealmListMessagesResultDto | undefined>(
    ['messages', input.chatId],
    (current) => applyRealmRealtimeMessageUpdateToMessagesResult(current, input.message),
  );
}

function upsertChatInChatsResult(
  current: RealmListChatsResultDto | undefined,
  chat: RealmChatViewDto,
): RealmListChatsResultDto | undefined {
  if (!current || !Array.isArray(current.items)) {
    return current;
  }
  const index = current.items.findIndex((item) => String(item.id || '') === String(chat.id || ''));
  if (index < 0) {
    return {
      ...current,
      items: [chat, ...current.items],
    };
  }
  const nextItems = current.items.slice();
  nextItems[index] = chat;
  return {
    ...current,
    items: nextItems,
  };
}

function applySyncSnapshotToCache(chatId: string, snapshot: RealmChatSyncResultDto['snapshot']): void {
  if (!snapshot) {
    return;
  }
  if (snapshot.chat) {
    const chatQueries = queryClient.getQueriesData<RealmListChatsResultDto>({ queryKey: ['chats'] });
    for (const [queryKey, current] of chatQueries) {
      queryClient.setQueryData(queryKey as QueryKey, upsertChatInChatsResult(current, snapshot.chat));
    }
  }
  if (Array.isArray(snapshot.messages)) {
    queryClient.setQueryData<RealmListMessagesResultDto>(['messages', chatId], {
      items: snapshot.messages,
      nextBefore: null,
      nextAfter: null,
    });
  }
}

function applyChatEventToCache(input: ApplyChatEventInput): void {
  const message = extractRealmMessageFromEvent(input.event);
  if (message && input.event.kind === 'message.created') {
    mergeMessageQueryByIncomingMessage({
      message,
      selectedChatId: input.selectedChatId,
    });

    const chatMerge = mergeChatQueriesByMessage({
      message,
      selectedChatId: input.selectedChatId,
      currentUserId: input.currentUserId,
    });
    if (!chatMerge.found) {
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    }
    if (chatMerge.shouldMarkRead) {
      void dataSync.markChatRead(message.chatId);
    }
    return;
  }

  if (
    message
    && (
      input.event.kind === 'message.edited'
      || input.event.kind === 'message.recalled'
    )
  ) {
    mergeMessageQueryByUpdate({
      chatId: input.event.chatId,
      message,
      selectedChatId: input.selectedChatId,
    });
    const found = mergeChatQueriesByUpdate({
      chatId: input.event.chatId,
      message,
    });
    if (!found) {
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    }
    return;
  }

  if (input.event.kind === 'chat.read') {
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
  }
}

export function rememberSeenEvent(seen: Map<string, number>, key: string): boolean {
  return rememberRealmChatSeenEvent(seen, key);
}

export function useChatRealtimeSync(): void {
  const authStatus = useAppStore((state) => state.auth.status);
  const authToken = useAppStore((state) => state.auth.token);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id || '')).trim();
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const offlineCoordinator = getOfflineCoordinator();

  const realtimeBaseUrl = useMemo(
    () => resolveRealtimeUrl({
      realmBaseUrl: runtimeDefaults?.realm.realmBaseUrl,
      realtimeUrl: runtimeDefaults?.realm.realtimeUrl,
    }),
    [runtimeDefaults?.realm.realmBaseUrl, runtimeDefaults?.realm.realtimeUrl],
  );

  useRealmChatRealtimeController({
    authStatus,
    authToken,
    fallbackToken: runtimeDefaults?.realm.accessToken,
    realtimeBaseUrl,
    selectedChatId,
    currentUserId,
    socketPath: CHAT_SOCKET_PATH,
    createSocket: ({ baseUrl, token, socketPath }) => io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      reconnectionAttempts: Infinity,
      auth: { token },
    }) as unknown as RealmChatRealtimeSocket,
    onSocketReachableChange: (reachable) => {
      offlineCoordinator.markRealmSocketReachable(reachable);
    },
    flushChatOutbox: () => dataSync.flushChatOutbox(),
    flushSocialOutbox: () => dataSync.flushSocialOutbox(),
    invalidateChats: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
    invalidateMessages: (chatId) => queryClient.invalidateQueries({ queryKey: ['messages', chatId] }),
    invalidateNotifications: () => invalidateNotificationQueries(),
    syncChatEvents: (chatId, afterSeq, limit) => dataSync.syncChatEvents(chatId, afterSeq, limit),
    loadMessages: (chatId) => dataSync.loadMessages(chatId),
    applyChatEvent: ({ event, selectedChatId: activeChatId, currentUserId: activeUserId }) => {
      applyChatEventToCache({
        event,
        selectedChatId: activeChatId,
        currentUserId: activeUserId,
      });
    },
    applySyncSnapshot: (chatId, snapshot) => {
      applySyncSnapshotToCache(chatId, snapshot);
    },
  });
}
