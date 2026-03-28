import { getPlatformClient } from '@nimiplatform/sdk';
import { useEffect, useMemo, useRef } from 'react';
import {
  useChatComposer,
  type UseChatComposerResult,
} from './headless.js';
import type { RealmMessageViewDto, RealmSendMessageInputDto } from './realm/codec.js';
import type {
  RealmChatComposerAdapter,
  RealmChatComposerAdapterOptions,
  RealmChatEventEnvelope,
  RealmChatEventEnvelopeDto,
  RealmChatRealtimeSocket,
  RealmChatService,
  RealmChatSessionReadyPayload,
  RealmChatSessionState,
  RealmChatSessionSyncRequiredPayload,
  RealmChatSyncResultDto,
  RealmChatViewDto,
  RealmListChatsResultDto,
  RealmListMessagesResultDto,
  RealmStartChatInputDto,
  RealmStartChatResultDto,
  UseRealmChatComposerOptions,
  UseRealmChatRealtimeControllerOptions,
} from './realm-types.js';

function realm() {
  return getPlatformClient().realm;
}

function normalizeText(value: string): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
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

function createCanonicalTextPayload(content: string) {
  return { content };
}

function buildRealmTextMessageInput(
  content: string,
  options: Partial<RealmSendMessageInputDto> = {},
): RealmSendMessageInputDto {
  const text = normalizeText(content);
  if (!text) {
    throw new Error('Chat message text is required');
  }
  const next = {
    type: 'TEXT',
    text,
    payload: createCanonicalTextPayload(text),
    ...options,
  } as RealmSendMessageInputDto;

  if (!normalizeText(String(next.text || ''))) {
    next.text = text;
  }
  if (!next.payload) {
    next.payload = createCanonicalTextPayload(text) as RealmSendMessageInputDto['payload'];
  }
  return next;
}

function rememberRealmChatSeenEvent(
  seen: Map<string, number>,
  key: string,
  limit = 3000,
): boolean {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) {
    return false;
  }
  if (seen.has(normalizedKey)) {
    seen.delete(normalizedKey);
    seen.set(normalizedKey, Date.now());
    return true;
  }
  seen.set(normalizedKey, Date.now());
  if (seen.size > limit) {
    const { done, value } = seen.keys().next();
    if (!done && value !== undefined) {
      seen.delete(value);
    }
  }
  return false;
}

function normalizeRealmChatEventEnvelope(payload: RealmChatEventEnvelopeDto): RealmChatEventEnvelope | null {
  const eventId = normalizeString(payload.eventId);
  const chatId = normalizeString(payload.chatId);
  const kind = normalizeString(payload.kind);
  const seqRaw = Number(payload.seq);
  const seq = Number.isFinite(seqRaw) ? Math.max(0, Math.floor(seqRaw)) : 0;
  if (!eventId || !chatId || !kind || seq <= 0) {
    return null;
  }
  return {
    ...payload,
    sessionId: normalizeString(payload.sessionId),
    eventId,
    chatId,
    kind,
    seq,
  };
}

function parseRealmSocketChatEvent(payload: unknown): RealmChatEventEnvelope | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const eventId = normalizeString(record.eventId);
  const chatId = normalizeString(record.chatId);
  const kind = normalizeString(record.kind);
  const seqRaw = Number(record.seq);
  const seq = Number.isFinite(seqRaw) ? Math.max(0, Math.floor(seqRaw)) : 0;
  if (!eventId || !chatId || !kind || seq <= 0) {
    return null;
  }
  return {
    actorId: normalizeString(record.actorId),
    seq,
    eventId,
    chatId,
    kind,
    occurredAt: normalizeString(record.occurredAt),
    payload: (asRecord(record.payload) ?? {}) as RealmChatEventEnvelopeDto['payload'],
    sessionId: normalizeString(record.sessionId),
  };
}

function parseRealmChatSessionReadyPayload(payload: unknown): RealmChatSessionReadyPayload | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const chatId = normalizeString(record.chatId);
  const sessionId = normalizeString(record.sessionId);
  const resumeToken = normalizeString(record.resumeToken);
  const lastAckSeqRaw = Number(record.lastAckSeq);
  const lastAckSeq = Number.isFinite(lastAckSeqRaw) ? Math.max(0, Math.floor(lastAckSeqRaw)) : 0;
  if (!chatId || !sessionId || !resumeToken) {
    return null;
  }
  return { chatId, sessionId, resumeToken, lastAckSeq };
}

function parseRealmChatSyncRequiredPayload(payload: unknown): RealmChatSessionSyncRequiredPayload | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const chatId = normalizeString(record.chatId);
  if (!chatId) {
    return null;
  }
  const requestedAfterSeqRaw = Number(record.requestedAfterSeq);
  return {
    chatId,
    requestedAfterSeq: Number.isFinite(requestedAfterSeqRaw)
      ? Math.max(0, Math.floor(requestedAfterSeqRaw))
      : 0,
  };
}

function getRealmReplayMaxSeq(events: readonly RealmChatEventEnvelopeDto[], fallbackSeq: number): number {
  return events.reduce((maxSeq, candidate) => {
    const normalized = normalizeRealmChatEventEnvelope(candidate);
    return normalized ? Math.max(maxSeq, normalized.seq) : maxSeq;
  }, fallbackSeq);
}

function createRealmChatSessionState(payload: RealmChatSessionReadyPayload): RealmChatSessionState {
  return {
    chatId: payload.chatId,
    sessionId: payload.sessionId,
    resumeToken: payload.resumeToken,
    lastAckSeq: payload.lastAckSeq,
  };
}

function createRealmChatSessionOpenPayload(
  chatId: string | null,
  session: RealmChatSessionState | null,
): { chatId: string; resumeToken?: string; lastAckSeq: number } | null {
  const normalizedChatId = normalizeString(chatId);
  if (!normalizedChatId) {
    return null;
  }
  return {
    chatId: normalizedChatId,
    resumeToken: session?.chatId === normalizedChatId ? session.resumeToken : undefined,
    lastAckSeq: session?.chatId === normalizedChatId ? session.lastAckSeq : 0,
  };
}

function advanceRealmChatSessionAck(
  session: RealmChatSessionState | null,
  event: RealmChatEventEnvelope,
): {
  nextSession: RealmChatSessionState;
  ackPayload: { chatId: string; sessionId: string; ackSeq: number };
} | null {
  if (!session || session.chatId !== event.chatId || event.seq <= session.lastAckSeq) {
    return null;
  }
  return {
    nextSession: { ...session, lastAckSeq: event.seq },
    ackPayload: {
      chatId: session.chatId,
      sessionId: session.sessionId,
      ackSeq: event.seq,
    },
  };
}

function resolveRealmChatSyncRequest(input: {
  payload: RealmChatSessionSyncRequiredPayload | null;
  selectedChatId: string | null;
  session: RealmChatSessionState | null;
}): { chatId: string; requestedAfterSeq: number } | null {
  const chatId = normalizeString(input.payload?.chatId || '');
  if (!chatId || chatId !== normalizeString(input.selectedChatId || '')) {
    return null;
  }
  return {
    chatId,
    requestedAfterSeq: input.payload && input.payload.requestedAfterSeq > 0
      ? input.payload.requestedAfterSeq
      : Math.max(0, Math.floor(input.session?.lastAckSeq || 0)),
  };
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
