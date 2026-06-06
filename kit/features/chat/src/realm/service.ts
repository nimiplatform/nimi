import type { RealmHumanChatModule, RealmModel } from '@nimiplatform/kit/core/sdk-contract';
import { useEffect, useMemo, useRef } from 'react';
import {
  useChatComposer,
  type UseChatComposerResult,
} from '../headless.js';
import type { RealmMessageViewDto, RealmSendMessageInputDto } from './codec.js';
import {
  advanceRealmChatSessionAck,
  createRealmChatSessionOpenPayload,
  createRealmChatSessionState,
  getRealmReplayMaxSeq,
  normalizeRealmChatEventEnvelope,
  parseRealmChatSessionReadyPayload,
  parseRealmChatSyncRequiredPayload,
  parseRealmSocketChatEvent,
  rememberRealmChatSeenEvent,
  resolveRealmChatSyncRequest,
} from './events.js';
import { buildRealmTextMessageInput, normalizeRealmRealtimeMessagePayload } from './messages.js';
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

function projectRealmMessageView(input: unknown): RealmMessageViewDto {
  const projected = normalizeRealmRealtimeMessagePayload(input);
  if (!projected) {
    throw new Error('Realm chat message projection failed');
  }
  return projected;
}

export function projectRealmChatView(input: RealmModel<'ChatViewDto'>): RealmChatViewDto {
  return {
    ...input,
    lastMessage: normalizeRealmRealtimeMessagePayload(input.lastMessage),
  };
}

function projectRealmListChatsResult(input: RealmModel<'ListChatsResultDto'>): RealmListChatsResultDto {
  return {
    ...input,
    items: input.items.map((item) => projectRealmChatView(item)),
  };
}

function projectRealmListMessagesResult(input: RealmModel<'ListMessagesResultDto'>): RealmListMessagesResultDto {
  return {
    ...input,
    items: input.items.map((item) => projectRealmMessageView(item)),
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeChatId(chatId: string): string {
  return String(chatId || '').trim();
}

export function normalizeRealmChatLimit(limit: number, fallback: number, max: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(max, Math.floor(limit));
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

export function createRealmChatService(humanChats: RealmHumanChatModule): RealmChatService {
  return {
    async listChats(limit = 20, cursor) {
      return projectRealmListChatsResult(await humanChats.listChats({
        path: {},
        query: {
          limit: normalizeRealmChatLimit(limit, 20, 100),
          cursor,
        },
      }));
    },
    async getChatById(chatId) {
      return projectRealmChatView(await humanChats.getChatById({
        path: { chatId: normalizeChatId(chatId) },
      }));
    },
    async startChat(input) {
      return humanChats.startChat({
        path: {},
        body: input,
      });
    },
    async listMessages(chatId, limit = 50, cursor) {
      return projectRealmListMessagesResult(await humanChats.listMessages({
        path: { chatId: normalizeChatId(chatId) },
        query: {
          limit: normalizeRealmChatLimit(limit, 50, 100),
          before: cursor,
        },
      }));
    },
    async sendMessage(chatId, input) {
      return projectRealmMessageView(await humanChats.sendMessage({
        path: { chatId: normalizeChatId(chatId) },
        body: input,
      }));
    },
    async markChatRead(chatId) {
      await humanChats.markChatRead({
        path: { chatId: normalizeChatId(chatId) },
      });
    },
    async syncChatEvents(chatId, afterSeq, limit = 200) {
      return humanChats.syncChatEvents({
        path: { chatId: normalizeChatId(chatId) },
        query: {
          limit: normalizeRealmChatLimit(limit, 200, 500),
          afterSeq: Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0,
        },
      });
    },
  };
}

export const realmChatService: RealmChatService = createUnavailableRealmChatService();

function createUnavailableRealmChatService(): RealmChatService {
  const unavailable = async (): Promise<never> => {
    throw new Error('Realm chat service requires an explicit Realm humanChats module.');
  };
  return {
    listChats: unavailable,
    getChatById: unavailable,
    startChat: unavailable,
    listMessages: unavailable,
    sendMessage: unavailable,
    markChatRead: unavailable,
    syncChatEvents: unavailable,
  };
}

export async function listRealmChats(
  limit = 20,
  cursor?: string,
  service: Pick<RealmChatService, 'listChats'> = realmChatService,
): Promise<RealmListChatsResultDto> {
  return service.listChats(normalizeRealmChatLimit(limit, 20, 100), cursor);
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

export function buildRealmStartChatInput(
  targetAccountId: string,
  initialMessage?: string | null,
): RealmStartChatInputDto {
  const normalizedTargetAccountId = normalizeString(targetAccountId);
  if (!normalizedTargetAccountId) {
    throw new Error('Target account id is required');
  }

  const normalizedMessage = normalizeString(initialMessage);
  if (!normalizedMessage) {
    return {
      targetAccountId: normalizedTargetAccountId,
    };
  }
  const textInput = buildRealmTextMessageInput(normalizedMessage);
  return {
    targetAccountId: normalizedTargetAccountId,
    text: textInput.text,
    type: textInput.type,
    payload: textInput.payload as RealmStartChatInputDto['payload'],
  };
}

export async function startRealmChatWithTarget(
  targetAccountId: string,
  initialMessage?: string | null,
  service: Pick<RealmChatService, 'startChat' | 'getChatById'> = realmChatService,
): Promise<RealmStartChatResultDto & { chat: RealmChatViewDto }> {
  const result = await service.startChat(buildRealmStartChatInput(targetAccountId, initialMessage));
  const chatId = normalizeChatId(result.chatId);
  if (!chatId) {
    throw new Error('Chat id is required');
  }
  const chat = await service.getChatById(chatId);
  return { ...result, chat };
}

export async function listRealmChatMessages(
  chatId: string,
  limit = 50,
  cursor?: string,
  service: Pick<RealmChatService, 'listMessages'> = realmChatService,
): Promise<RealmListMessagesResultDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.listMessages(normalizedChatId, normalizeRealmChatLimit(limit, 50, 100), cursor);
}

export async function sendRealmChatMessage(chatId: string, input: string | RealmSendMessageInputDto, service: RealmChatService = realmChatService): Promise<RealmMessageViewDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.sendMessage(normalizedChatId, typeof input === 'string' ? buildRealmTextMessageInput(input) : input);
}

export async function markRealmChatRead(
  chatId: string,
  service: Pick<RealmChatService, 'markChatRead'> = realmChatService,
): Promise<void> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  await service.markChatRead(normalizedChatId);
}

export async function syncRealmChatEvents(
  chatId: string,
  afterSeq: number,
  limit = 200,
  service: Pick<RealmChatService, 'syncChatEvents'> = realmChatService,
): Promise<RealmChatSyncResultDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  return service.syncChatEvents(normalizedChatId, normalizedAfterSeq, normalizeRealmChatLimit(limit, 200, 500));
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
  resolveAuthToken,
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
    if (authStatus !== 'authenticated' || !realtimeBaseUrl) {
      return undefined;
    }

    let disposed = false;
    let socket: RealmChatRealtimeSocket | null = null;
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
      const activeSocket = socket;
      if (!activeSocket) {
        return;
      }
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
              activeSocket.emit('chat:event.ack', {
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

    const attachSocket = async () => {
      const immediateToken = normalizeString(authToken || fallbackToken || '');
      const resolvedToken = immediateToken || normalizeString(await resolveAuthToken?.());
      if (disposed || !resolvedToken) {
        return;
      }
      socket = callbacksRef.current.createSocket({
        baseUrl: realtimeBaseUrl,
        token: resolvedToken,
        socketPath,
      });
      socketRef.current = socket;
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('chat:session.ready', onSessionReady);
      socket.on('chat:event', onChatEvent);
      socket.on('chat:session.sync_required', onSyncRequired);
      socket.on('notif:new', onNotification);
    };

    void attachSocket();

    return () => {
      disposed = true;
      if (socket) {
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
      }
      seenEventsRef.current.clear();
      setSession(null);
    };
  }, [authStatus, authToken, fallbackToken, realtimeBaseUrl, resolveAuthToken, socketPath]);

  useEffect(() => {
    openRealmChatSessionOnSocket(socketRef.current, sessionRef.current, selectedChatId);
  }, [selectedChatId]);
}
