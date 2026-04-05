import { getPlatformClient } from '@nimiplatform/sdk';
import { useEffect, useMemo, useRef } from 'react';
import {
  useChatComposer,
  type UseChatComposerResult,
} from '../headless.js';
import type { RealmMessageViewDto, RealmSendMessageInputDto } from './codec.js';
import {
  advanceRealmChatSessionAck,
  buildRealmTextMessageInput,
  createRealmChatSessionOpenPayload,
  createRealmChatSessionState,
  getRealmReplayMaxSeq,
  normalizeRealmChatEventEnvelope,
  parseRealmChatSessionReadyPayload,
  parseRealmChatSyncRequiredPayload,
  parseRealmSocketChatEvent,
  rememberRealmChatSeenEvent,
  resolveRealmChatSyncRequest,
} from './helpers.js';
import type {
  RealmChatComposerAdapter,
  RealmChatComposerAdapterOptions,
  RealmChatEventEnvelope,
  RealmChatRealtimeSocket,
  RealmChatService,
  RealmChatSessionState,
  RealmChatSyncResultDto,
  RealmChatViewDto,
  RealmListChatsResultDto,
  RealmListMessagesResultDto,
  RealmStartChatInputDto,
  RealmStartChatResultDto,
  UseRealmChatComposerOptions,
  UseRealmChatRealtimeControllerOptions,
} from './types.js';

function realm() {
  return getPlatformClient().realm;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeChatId(chatId: string): string {
  return String(chatId || '').trim();
}

function normalizeLimit(limit: number, fallback: number, max: number): number {
  return Number.isFinite(limit) ? Math.min(max, Math.max(1, Math.floor(limit))) : fallback;
}

function openRealmChatSessionOnSocket(
  socket: RealmChatRealtimeSocket | null,
  session: RealmChatSessionState | null,
  chatId: string | null,
): void {
  if (!socket || !socket.connected) {
    return;
  }
  const payload = createRealmChatSessionOpenPayload(chatId, session);
  if (payload) {
    socket.emit('chat:session.open', payload);
  }
}

function ackRealmChatEventOnSocket(
  socket: RealmChatRealtimeSocket | null,
  session: RealmChatSessionState | null,
  event: RealmChatEventEnvelope,
  updateSession: (nextSession: RealmChatSessionState) => void,
): void {
  if (!socket || !session) {
    return;
  }
  const next = advanceRealmChatSessionAck(session, event);
  if (!next) {
    return;
  }
  updateSession(next.nextSession);
  socket.emit('chat:event.ack', next.ackPayload);
}

export const realmChatService: RealmChatService = {
  async listChats(limit = 20, cursor) {
    return realm().services.HumanChatsService.listChats(normalizeLimit(limit, 20, 100), cursor);
  },
  async getChatById(chatId) {
    return realm().services.HumanChatsService.getChatById(normalizeChatId(chatId));
  },
  async startChat(input) {
    return realm().services.HumanChatsService.startChat(input);
  },
  async listMessages(chatId, limit = 50, cursor) {
    return realm().services.HumanChatsService.listMessages(
      normalizeChatId(chatId),
      normalizeLimit(limit, 50, 100),
      undefined,
      undefined,
      cursor,
    );
  },
  async sendMessage(chatId, input) {
    return realm().services.HumanChatsService.sendMessage(normalizeChatId(chatId), input);
  },
  async markChatRead(chatId) {
    await realm().services.HumanChatsService.markChatRead(normalizeChatId(chatId));
  },
  async syncChatEvents(chatId, afterSeq, limit = 200) {
    return realm().services.HumanChatsService.syncChatEvents(
      normalizeChatId(chatId),
      normalizeLimit(limit, 200, 500),
      Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0,
    );
  },
};

export async function listRealmChats(limit = 20, cursor?: string, service: RealmChatService = realmChatService): Promise<RealmListChatsResultDto> {
  return service.listChats(limit, cursor);
}

export async function getRealmChat(chatId: string, service: RealmChatService = realmChatService): Promise<RealmChatViewDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.getChatById(normalizedChatId);
}

export async function startRealmChat(input: RealmStartChatInputDto, service: RealmChatService = realmChatService): Promise<RealmStartChatResultDto> {
  return service.startChat(input);
}

export async function listRealmChatMessages(chatId: string, limit = 50, cursor?: string, service: RealmChatService = realmChatService): Promise<RealmListMessagesResultDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.listMessages(normalizedChatId, limit, cursor);
}

export async function sendRealmChatMessage(chatId: string, input: string | RealmSendMessageInputDto, service: RealmChatService = realmChatService): Promise<RealmMessageViewDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.sendMessage(normalizedChatId, typeof input === 'string' ? buildRealmTextMessageInput(input) : input);
}

export async function markRealmChatRead(chatId: string, service: RealmChatService = realmChatService): Promise<void> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  await service.markChatRead(normalizedChatId);
}

export async function syncRealmChatEvents(chatId: string, afterSeq: number, limit = 200, service: RealmChatService = realmChatService): Promise<RealmChatSyncResultDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.syncChatEvents(normalizedChatId, afterSeq, limit);
}

export function createRealmChatComposerAdapter<TAttachment = never>({
  chatId,
  service = realmChatService,
  messageOptions = {},
  resolveMessageInput,
  onResponse,
}: RealmChatComposerAdapterOptions<TAttachment>): RealmChatComposerAdapter<TAttachment> {
  return {
    submit: async (input) => {
      const normalizedChatId = normalizeChatId(chatId);
      if (!normalizedChatId) {
        throw new Error('Chat id is required');
      }
      const payload = resolveMessageInput
        ? await resolveMessageInput(input)
        : buildRealmTextMessageInput(input.text, messageOptions);
      const message = await service.sendMessage(normalizedChatId, payload);
      await onResponse?.(message, input);
    },
  };
}

export function useRealmChatComposer<TAttachment = never>({
  chatId,
  service = realmChatService,
  messageOptions,
  resolveMessageInput,
  onResponse,
  ...composerOptions
}: UseRealmChatComposerOptions<TAttachment>): UseChatComposerResult<TAttachment> {
  const adapter = useMemo(
    () => createRealmChatComposerAdapter<TAttachment>({
      chatId,
      service,
      messageOptions,
      resolveMessageInput,
      onResponse,
    }),
    [chatId, messageOptions, onResponse, resolveMessageInput, service],
  );

  return useChatComposer<TAttachment>({
    ...composerOptions,
    adapter,
  });
}

export function useRealmChatRealtimeController({
  authStatus,
  authToken,
  fallbackToken,
  realtimeBaseUrl,
  selectedChatId,
  currentUserId,
  socketPath,
  createSocket,
  onSocketReachableChange,
  flushChatOutbox,
  flushSocialOutbox,
  invalidateChats,
  invalidateMessages,
  invalidateNotifications,
  syncChatEvents,
  loadMessages,
  applyChatEvent,
  applySyncSnapshot,
}: UseRealmChatRealtimeControllerOptions): void {
  const socketRef = useRef<RealmChatRealtimeSocket | null>(null);
  const selectedChatIdRef = useRef<string | null>(selectedChatId);
  const currentUserIdRef = useRef(currentUserId);
  const seenEventsRef = useRef<Map<string, number>>(new Map());
  const sessionRef = useRef<RealmChatSessionState | null>(null);
  const callbacksRef = useRef({
    createSocket,
    onSocketReachableChange,
    flushChatOutbox,
    flushSocialOutbox,
    invalidateChats,
    invalidateMessages,
    invalidateNotifications,
    syncChatEvents,
    loadMessages,
    applyChatEvent,
    applySyncSnapshot,
  });

  useEffect(() => {
    callbacksRef.current = {
      createSocket,
      onSocketReachableChange,
      flushChatOutbox,
      flushSocialOutbox,
      invalidateChats,
      invalidateMessages,
      invalidateNotifications,
      syncChatEvents,
      loadMessages,
      applyChatEvent,
      applySyncSnapshot,
    };
  }, [
    createSocket,
    onSocketReachableChange,
    flushChatOutbox,
    flushSocialOutbox,
    invalidateChats,
    invalidateMessages,
    invalidateNotifications,
    syncChatEvents,
    loadMessages,
    applyChatEvent,
    applySyncSnapshot,
  ]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    const normalizedToken = normalizeString(authToken || fallbackToken || '');
    if (authStatus !== 'authenticated' || !normalizedToken || !realtimeBaseUrl) {
      return undefined;
    }

    const socket = callbacksRef.current.createSocket({
      baseUrl: realtimeBaseUrl,
      token: normalizedToken,
      socketPath,
    });
    socketRef.current = socket;
    let disposed = false;
    const isSocketActive = () => !disposed && socketRef.current === socket;
    const setSession = (nextSession: RealmChatSessionState | null) => {
      sessionRef.current = nextSession;
    };

    const onConnect = () => {
      callbacksRef.current.onSocketReachableChange?.(true);
      openRealmChatSessionOnSocket(socket, sessionRef.current, selectedChatIdRef.current);
      void callbacksRef.current.flushChatOutbox?.();
      void callbacksRef.current.flushSocialOutbox?.();
      void callbacksRef.current.invalidateChats?.();
      void callbacksRef.current.invalidateNotifications?.();
      if (selectedChatIdRef.current) {
        void callbacksRef.current.invalidateMessages?.(selectedChatIdRef.current);
      }
    };

    const onSessionReady = (payload: unknown) => {
      const session = parseRealmChatSessionReadyPayload(payload);
      if (!session) {
        return;
      }
      setSession(createRealmChatSessionState(session));
      void callbacksRef.current.flushChatOutbox?.();
    };

    const onChatEvent = (payload: unknown) => {
      const event = parseRealmSocketChatEvent(payload);
      if (!event) {
        return;
      }
      if (rememberRealmChatSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) {
        ackRealmChatEventOnSocket(socket, sessionRef.current, event, setSession);
        return;
      }
      callbacksRef.current.applyChatEvent({
        event,
        selectedChatId: selectedChatIdRef.current,
        currentUserId: currentUserIdRef.current,
      });
      ackRealmChatEventOnSocket(socket, sessionRef.current, event, setSession);
    };

    const onSyncRequired = (payload: unknown) => {
      const nextSync = resolveRealmChatSyncRequest({
        payload: parseRealmChatSyncRequiredPayload(payload),
        selectedChatId: selectedChatIdRef.current,
        session: sessionRef.current,
      });
      if (!nextSync) {
        return;
      }
      void callbacksRef.current
        .syncChatEvents(nextSync.chatId, nextSync.requestedAfterSeq, 200)
        .then((result) => {
          if (!isSocketActive() || selectedChatIdRef.current !== nextSync.chatId) {
            return;
          }
          callbacksRef.current.applySyncSnapshot(nextSync.chatId, result.snapshot);
          if (Array.isArray(result.events)) {
            for (const candidate of result.events) {
              const event = normalizeRealmChatEventEnvelope(candidate);
              if (!event || rememberRealmChatSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) {
                continue;
              }
              callbacksRef.current.applyChatEvent({
                event,
                selectedChatId: selectedChatIdRef.current,
                currentUserId: currentUserIdRef.current,
              });
            }
          }

          if (sessionRef.current && sessionRef.current.chatId === nextSync.chatId) {
            const replayMaxSeq = Array.isArray(result.events)
              ? getRealmReplayMaxSeq(result.events, sessionRef.current.lastAckSeq)
              : sessionRef.current.lastAckSeq;
            if (replayMaxSeq > sessionRef.current.lastAckSeq) {
              setSession({
                ...sessionRef.current,
                lastAckSeq: replayMaxSeq,
              });
              socket.emit('chat:event.ack', {
                chatId: nextSync.chatId,
                sessionId: sessionRef.current.sessionId,
                ackSeq: replayMaxSeq,
              });
            }
          }

          void callbacksRef.current.invalidateChats?.();
        })
        .catch(() => {
          if (!isSocketActive() || selectedChatIdRef.current !== nextSync.chatId) {
            return;
          }
          void callbacksRef.current.loadMessages(nextSync.chatId);
          void callbacksRef.current.invalidateChats?.();
        });
    };

    const onNotification = () => {
      void callbacksRef.current.invalidateNotifications?.();
    };

    const onDisconnect = () => {
      callbacksRef.current.onSocketReachableChange?.(false);
      void callbacksRef.current.invalidateChats?.();
      const activeChatId = selectedChatIdRef.current;
      if (activeChatId && sessionRef.current?.chatId === activeChatId) {
        void callbacksRef.current
          .syncChatEvents(activeChatId, sessionRef.current.lastAckSeq, 200)
          .then((result) => {
            if (!isSocketActive() || selectedChatIdRef.current !== activeChatId) {
              return;
            }
            callbacksRef.current.applySyncSnapshot(activeChatId, result.snapshot);
            if (Array.isArray(result.events)) {
              for (const candidate of result.events) {
                const event = normalizeRealmChatEventEnvelope(candidate);
                if (!event || rememberRealmChatSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) {
                  continue;
                }
                callbacksRef.current.applyChatEvent({
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
            void callbacksRef.current.invalidateMessages?.(activeChatId);
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
      setSession(null);
    };
  }, [authStatus, authToken, fallbackToken, realtimeBaseUrl, socketPath]);

  useEffect(() => {
    openRealmChatSessionOnSocket(socketRef.current, sessionRef.current, selectedChatId);
  }, [selectedChatId]);
}
