import { useEffect, useMemo, useRef } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { QueryKey } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { dataSync } from '@runtime/data-sync';
import { getOfflineCoordinator } from '@runtime/offline';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { invalidateNotificationQueries } from '@renderer/features/notification/notification-query.js';
import {
  applyRealtimeMessageToChatsResult,
  applyRealtimeMessageUpdateToChatsResult,
  applyRealtimeMessageUpdateToMessagesResult,
  mergeRealtimeMessageIntoMessagesResult,
  normalizeRealtimeMessagePayload,
} from './chat-realtime-cache';
import { resolveRealtimeUrl } from './resolve-realtime-url';

type ChatSyncResultDto = RealmModel<'ChatSyncResultDto'>;
type ChatEventEnvelopeDto = RealmModel<'ChatEventEnvelopeDto'>;
type ChatViewDto = RealmModel<'ChatViewDto'>;
type ListChatsResultDto = RealmModel<'ListChatsResultDto'>;
type ListMessagesResultDto = RealmModel<'ListMessagesResultDto'>;
type MessageViewDto = RealmModel<'MessageViewDto'>;

const CHAT_SOCKET_PATH = '/socket.io/';
const SEEN_EVENT_LIMIT = 3000;

type ChatEventEnvelope = ChatEventEnvelopeDto;

type ChatSessionState = {
  chatId: string;
  sessionId: string;
  resumeToken: string;
  lastAckSeq: number;
};

type ChatSessionReadyPayload = {
  chatId: string;
  sessionId: string;
  resumeToken: string;
  lastAckSeq: number;
};

type ChatSessionSyncRequiredPayload = {
  chatId: string;
  requestedAfterSeq: number;
};

type ApplyChatEventInput = {
  event: ChatEventEnvelope;
  selectedChatId: string | null;
  currentUserId: string;
};

function hasMessageQuery(chatId: string): boolean {
  return queryClient.getQueryState(['messages', chatId]) !== undefined;
}

function rememberSeenEvent(seen: Map<string, number>, key: string): boolean {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return false;
  }
  if (seen.has(normalizedKey)) {
    // LRU promotion: delete and re-insert to move entry to newest position
    seen.delete(normalizedKey);
    seen.set(normalizedKey, Date.now());
    return true;
  }
  seen.set(normalizedKey, Date.now());
  if (seen.size > SEEN_EVENT_LIMIT) {
    // Evict the least recently used entry (first in Map iteration order)
    const oldest = seen.keys().next().value;
    if (oldest) {
      seen.delete(oldest);
    }
  }
  return false;
}

function isObjectLike(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object';
}

function readStringField(value: unknown, key: string): string {
  if (!isObjectLike(value)) {
    return '';
  }
  const field = Reflect.get(value, key);
  return typeof field === 'string' ? field.trim() : '';
}

function readNumberField(value: unknown, key: string): number | null {
  if (!isObjectLike(value)) {
    return null;
  }
  const numeric = Number(Reflect.get(value, key));
  return Number.isFinite(numeric) ? numeric : null;
}

function readObjectField(value: unknown, key: string): object | null {
  if (!isObjectLike(value)) {
    return null;
  }
  const field = Reflect.get(value, key);
  return isObjectLike(field) ? field : null;
}

function normalizeChatEventEnvelope(payload: ChatEventEnvelopeDto): ChatEventEnvelope | null {
  const eventId = String(payload.eventId || '').trim();
  const chatId = String(payload.chatId || '').trim();
  const kind = String(payload.kind || '').trim();
  const seqRaw = Number(payload.seq);
  const seq = Number.isFinite(seqRaw) ? Math.max(0, Math.floor(seqRaw)) : 0;
  if (!eventId || !chatId || !kind || seq <= 0) {
    return null;
  }
  return {
    ...payload,
    sessionId: String(payload.sessionId || '').trim(),
    eventId,
    chatId,
    kind,
    seq,
  };
}

function parseSocketChatEvent(payload: unknown): ChatEventEnvelope | null {
  if (!isObjectLike(payload)) {
    return null;
  }
  const eventId = readStringField(payload, 'eventId');
  const chatId = readStringField(payload, 'chatId');
  const kind = readStringField(payload, 'kind');
  const seqRaw = readNumberField(payload, 'seq');
  const seq = seqRaw !== null ? Math.max(0, Math.floor(seqRaw)) : 0;
  if (!eventId || !chatId || !kind || seq <= 0) {
    return null;
  }
  const payloadObject = readObjectField(payload, 'payload');
  return {
    actionHint: readStringField(payload, 'actionHint') || undefined,
    actorId: readStringField(payload, 'actorId'),
    seq,
    eventId,
    chatId,
    kind,
    occurredAt: readStringField(payload, 'occurredAt'),
    payload: payloadObject ? (payloadObject as ChatEventEnvelopeDto['payload']) : {},
    reasonCode: readStringField(payload, 'reasonCode') || undefined,
    sessionId: readStringField(payload, 'sessionId'),
    turnAudit: readObjectField(payload, 'turnAudit') ? (readObjectField(payload, 'turnAudit') as ChatEventEnvelopeDto['turnAudit']) : undefined,
  };
}

function extractMessageFromEvent(event: ChatEventEnvelope): MessageViewDto | null {
  const candidate = readObjectField(event.payload, 'message');
  return candidate ? normalizeRealtimeMessagePayload(candidate) : null;
}

function parseSessionReadyPayload(payload: unknown): ChatSessionReadyPayload | null {
  if (!isObjectLike(payload)) {
    return null;
  }
  const chatId = readStringField(payload, 'chatId');
  const sessionId = readStringField(payload, 'sessionId');
  const resumeToken = readStringField(payload, 'resumeToken');
  const lastAckSeqRaw = readNumberField(payload, 'lastAckSeq');
  const lastAckSeq = lastAckSeqRaw !== null ? Math.max(0, Math.floor(lastAckSeqRaw)) : 0;
  if (!chatId || !sessionId || !resumeToken) {
    return null;
  }
  return {
    chatId,
    sessionId,
    resumeToken,
    lastAckSeq,
  };
}

function parseSyncRequiredPayload(payload: unknown): ChatSessionSyncRequiredPayload | null {
  if (!isObjectLike(payload)) {
    return null;
  }
  const chatId = readStringField(payload, 'chatId');
  if (!chatId) {
    return null;
  }
  const requestedAfterSeqRaw = readNumberField(payload, 'requestedAfterSeq');
  return {
    chatId,
    requestedAfterSeq: requestedAfterSeqRaw !== null
      ? Math.max(0, Math.floor(requestedAfterSeqRaw))
      : 0,
  };
}

function getReplayMaxSeq(events: ChatEventEnvelopeDto[], fallbackSeq: number): number {
  return events.reduce((maxSeq, candidate) => {
    const normalized = normalizeChatEventEnvelope(candidate);
    if (!normalized) {
      return maxSeq;
    }
    return Math.max(maxSeq, normalized.seq);
  }, fallbackSeq);
}

function mergeChatQueriesByMessage(input: {
  message: MessageViewDto;
  selectedChatId: string | null;
  currentUserId: string;
}): { found: boolean; shouldMarkRead: boolean } {
  const queries = queryClient.getQueriesData<ListChatsResultDto>({
    queryKey: ['chats'],
  });
  if (queries.length === 0) {
    return { found: false, shouldMarkRead: false };
  }

  let found = false;
  let shouldMarkRead = false;

  for (const [queryKey, current] of queries) {
    const result = applyRealtimeMessageToChatsResult({
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
  message: MessageViewDto;
}): boolean {
  const queries = queryClient.getQueriesData<ListChatsResultDto>({
    queryKey: ['chats'],
  });
  if (queries.length === 0) {
    return false;
  }

  let found = false;
  for (const [queryKey, current] of queries) {
    const result = applyRealtimeMessageUpdateToChatsResult({
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
  message: MessageViewDto;
  selectedChatId: string | null;
}): void {
  const shouldWriteMessageCache =
    input.selectedChatId === input.message.chatId
    || hasMessageQuery(input.message.chatId);
  if (!shouldWriteMessageCache) {
    return;
  }

  queryClient.setQueryData<ListMessagesResultDto>(
    ['messages', input.message.chatId],
    (current) => mergeRealtimeMessageIntoMessagesResult(current, input.message),
  );
}

function mergeMessageQueryByUpdate(input: {
  chatId: string;
  message: MessageViewDto;
  selectedChatId: string | null;
}): void {
  const shouldPatchMessageCache =
    input.selectedChatId === input.chatId
    || hasMessageQuery(input.chatId);
  if (!shouldPatchMessageCache) {
    return;
  }

  queryClient.setQueryData<ListMessagesResultDto | undefined>(
    ['messages', input.chatId],
    (current) => applyRealtimeMessageUpdateToMessagesResult(current, input.message),
  );
}

function upsertChatInChatsResult(
  current: ListChatsResultDto | undefined,
  chat: ChatViewDto,
): ListChatsResultDto | undefined {
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

function applySyncSnapshotToCache(chatId: string, snapshot: ChatSyncResultDto['snapshot']): void {
  if (!snapshot) {
    return;
  }
  if (snapshot.chat) {
    const chatQueries = queryClient.getQueriesData<ListChatsResultDto>({ queryKey: ['chats'] });
    for (const [queryKey, current] of chatQueries) {
      queryClient.setQueryData(queryKey as QueryKey, upsertChatInChatsResult(current, snapshot.chat));
    }
  }
  if (Array.isArray(snapshot.messages)) {
    queryClient.setQueryData<ListMessagesResultDto>(['messages', chatId], {
      items: snapshot.messages,
      nextBefore: null,
      nextAfter: null,
    });
  }
}

function applyChatEventToCache(input: ApplyChatEventInput): void {
  const message = extractMessageFromEvent(input.event);
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
      || input.event.kind === 'interaction.command'
      || input.event.kind === 'interaction.component'
      || input.event.kind === 'interaction.modal'
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

function openChatSession(socket: Socket | null, session: ChatSessionState | null, chatId: string | null): void {
  if (!socket || !socket.connected) {
    return;
  }
  const normalizedChatId = String(chatId || '').trim();
  if (!normalizedChatId) {
    return;
  }
  socket.emit('chat:session.open', {
    chatId: normalizedChatId,
    resumeToken: session?.chatId === normalizedChatId ? session.resumeToken : undefined,
    lastAckSeq: session?.chatId === normalizedChatId ? session.lastAckSeq : 0,
  });
}

function ackChatEvent(socket: Socket | null, session: ChatSessionState | null, event: ChatEventEnvelope): void {
  if (!socket || !session || session.chatId !== event.chatId) {
    return;
  }
  if (event.seq <= session.lastAckSeq) {
    return;
  }
  session.lastAckSeq = event.seq;
  socket.emit('chat:event.ack', {
    chatId: session.chatId,
    sessionId: session.sessionId,
    ackSeq: event.seq,
  });
}

export function useChatRealtimeSync(): void {
  const authStatus = useAppStore((state) => state.auth.status);
  const authToken = useAppStore((state) => state.auth.token);
  const currentUserId = String(useAppStore((state) => state.auth.user?.id || '')).trim();
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const socketRef = useRef<Socket | null>(null);
  const selectedChatIdRef = useRef<string | null>(selectedChatId);
  const currentUserIdRef = useRef(currentUserId);
  const seenEventsRef = useRef<Map<string, number>>(new Map());
  const sessionRef = useRef<ChatSessionState | null>(null);

  const realtimeBaseUrl = useMemo(
    () => resolveRealtimeUrl({
      realmBaseUrl: runtimeDefaults?.realm.realmBaseUrl,
      realtimeUrl: runtimeDefaults?.realm.realtimeUrl,
    }),
    [runtimeDefaults?.realm.realmBaseUrl, runtimeDefaults?.realm.realtimeUrl],
  );

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    const normalizedToken = String(authToken || runtimeDefaults?.realm.accessToken || '').trim();
    if (authStatus !== 'authenticated' || !normalizedToken || !realtimeBaseUrl) {
      return undefined;
    }

    const offlineCoordinator = getOfflineCoordinator();
    const socket = io(realtimeBaseUrl, {
      path: CHAT_SOCKET_PATH,
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      reconnectionAttempts: Infinity,
      auth: {
        token: normalizedToken,
      },
    });
    socketRef.current = socket;
    let disposed = false;
    const isSocketActive = () => !disposed && socketRef.current === socket;

    const onConnect = () => {
      offlineCoordinator.markRealmSocketReachable(true);
      openChatSession(socket, sessionRef.current, selectedChatIdRef.current);
      void dataSync.flushChatOutbox();
      void dataSync.flushSocialOutbox();
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      void invalidateNotificationQueries();
      if (selectedChatIdRef.current) {
        void queryClient.invalidateQueries({ queryKey: ['messages', selectedChatIdRef.current] });
      }
    };

    const onSessionReady = (payload: unknown) => {
      const session = parseSessionReadyPayload(payload);
      if (!session) {
        return;
      }
      sessionRef.current = {
        chatId: session.chatId,
        sessionId: session.sessionId,
        resumeToken: session.resumeToken,
        lastAckSeq: session.lastAckSeq,
      };
      void dataSync.flushChatOutbox();
    };

    const onChatEvent = (payload: unknown) => {
      const event = parseSocketChatEvent(payload);
      if (!event) {
        return;
      }
      if (rememberSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) {
        ackChatEvent(socket, sessionRef.current, event);
        return;
      }
      applyChatEventToCache({
        event,
        selectedChatId: selectedChatIdRef.current,
        currentUserId: currentUserIdRef.current,
      });

      ackChatEvent(socket, sessionRef.current, event);
    };

    const onSyncRequired = (payload: unknown) => {
      const syncRequired = parseSyncRequiredPayload(payload);
      const chatId = syncRequired?.chatId || '';
      if (!chatId || chatId !== selectedChatIdRef.current) {
        return;
      }
      const requestedAfterSeq = syncRequired && syncRequired.requestedAfterSeq > 0
        ? syncRequired.requestedAfterSeq
        : Math.max(0, Math.floor(sessionRef.current?.lastAckSeq || 0));
      void dataSync
        .syncChatEvents(chatId, requestedAfterSeq, 200)
        .then((result) => {
          if (!isSocketActive() || selectedChatIdRef.current !== chatId) {
            return;
          }
          applySyncSnapshotToCache(chatId, result.snapshot);
          if (Array.isArray(result.events)) {
            for (const candidate of result.events) {
              const event = normalizeChatEventEnvelope(candidate);
              if (!event) {
                continue;
              }
              if (rememberSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) {
                continue;
              }
              applyChatEventToCache({
                event,
                selectedChatId: selectedChatIdRef.current,
                currentUserId: currentUserIdRef.current,
              });
            }
          }

          if (sessionRef.current && sessionRef.current.chatId === chatId) {
            const replayMaxSeq = Array.isArray(result.events)
              ? getReplayMaxSeq(result.events, sessionRef.current?.lastAckSeq ?? 0)
              : sessionRef.current.lastAckSeq;
            if (replayMaxSeq > sessionRef.current.lastAckSeq) {
              sessionRef.current.lastAckSeq = replayMaxSeq;
              socket.emit('chat:event.ack', {
                chatId,
                sessionId: sessionRef.current.sessionId,
                ackSeq: replayMaxSeq,
              });
            }
          }

          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        })
        .catch(() => {
          if (!isSocketActive() || selectedChatIdRef.current !== chatId) {
            return;
          }
          void dataSync.loadMessages(chatId);
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
        });
    };

    const onNotification = () => {
      void invalidateNotificationQueries();
    };

    const onDisconnect = () => {
      offlineCoordinator.markRealmSocketReachable(false);
      // D-NET-007: Socket disconnected → refresh chat data from REST
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      const activeChatId = selectedChatIdRef.current;
      if (activeChatId && sessionRef.current?.chatId === activeChatId) {
        void dataSync
          .syncChatEvents(activeChatId, sessionRef.current.lastAckSeq, 200)
          .then((result) => {
            if (!isSocketActive() || selectedChatIdRef.current !== activeChatId) {
              return;
            }
            applySyncSnapshotToCache(activeChatId, result.snapshot);
            if (Array.isArray(result.events)) {
              for (const candidate of result.events) {
                const event = normalizeChatEventEnvelope(candidate);
                if (!event) continue;
                if (rememberSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) continue;
                applyChatEventToCache({
                  event,
                  selectedChatId: selectedChatIdRef.current,
                  currentUserId: currentUserIdRef.current,
                });
              }
            }
          })
          .catch(() => {
            if (!isSocketActive() || selectedChatIdRef.current !== activeChatId) {
              return;
            }
            void queryClient.invalidateQueries({ queryKey: ['messages', activeChatId] });
          });
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('chat:session.ready', onSessionReady);
    socket.on('chat:event', onChatEvent);
    socket.on('chat:session.sync_required', onSyncRequired);
    socket.on('notif:new', onNotification);

    return () => {
      disposed = true;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('chat:session.ready', onSessionReady);
      socket.off('chat:event', onChatEvent);
      socket.off('chat:session.sync_required', onSyncRequired);
      socket.off('notif:new', onNotification);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      seenEventsRef.current.clear();
      sessionRef.current = null;
    };
  }, [authStatus, authToken, realtimeBaseUrl, runtimeDefaults?.realm.accessToken]);

  useEffect(() => {
    openChatSession(socketRef.current, sessionRef.current, selectedChatId);
  }, [selectedChatId]);
}
