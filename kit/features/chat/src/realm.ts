import { getPlatformClient } from '@nimiplatform/sdk';
import { useEffect, useMemo, useRef } from 'react';
import {
  useChatComposer,
  type UseChatComposerOptions,
  type UseChatComposerResult,
} from './headless.js';
import type { ChatComposerAdapter, ChatComposerSubmitInput } from './types.js';

function realm() {
  return getPlatformClient().realm;
}

type HumanChatsService = ReturnType<typeof realm>['services']['HumanChatsService'];

export type RealmChatViewDto =
  Awaited<ReturnType<HumanChatsService['getChatById']>>;
export type RealmListChatsResultDto =
  Awaited<ReturnType<HumanChatsService['listChats']>>;
export type RealmListMessagesResultDto =
  Awaited<ReturnType<HumanChatsService['listMessages']>>;
export type RealmStartChatInputDto =
  Parameters<HumanChatsService['startChat']>[0];
export type RealmStartChatResultDto =
  Awaited<ReturnType<HumanChatsService['startChat']>>;
export type RealmSendMessageInputDto =
  Parameters<HumanChatsService['sendMessage']>[1];
export type RealmMessageViewDto =
  Awaited<ReturnType<HumanChatsService['sendMessage']>>;
export type RealmChatSyncResultDto =
  Awaited<ReturnType<HumanChatsService['syncChatEvents']>>;
export type RealmChatEventEnvelopeDto =
  NonNullable<RealmChatSyncResultDto['events']>[number];
export type RealmChatSessionState = {
  chatId: string;
  sessionId: string;
  resumeToken: string;
  lastAckSeq: number;
};
export type RealmChatSessionReadyPayload = {
  chatId: string;
  sessionId: string;
  resumeToken: string;
  lastAckSeq: number;
};
export type RealmChatSessionSyncRequiredPayload = {
  chatId: string;
  requestedAfterSeq: number;
};
export type RealmChatRealtimeSocket = {
  connected: boolean;
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
  off: (event: string, handler: (payload: unknown) => void) => void;
  disconnect: () => void;
};
export type RealmChatRealtimeSocketFactory = (input: {
  baseUrl: string;
  token: string;
  socketPath?: string;
}) => RealmChatRealtimeSocket;
export type RealmChatEventEnvelope = RealmChatEventEnvelopeDto & {
  eventId: string;
  chatId: string;
  kind: string;
  seq: number;
  sessionId: string;
};
export type RealmChatTimelineMessage = RealmMessageViewDto & {
  deliveryState: 'sent' | 'pending' | 'failed';
  deliveryError?: string | null;
  localPreviewUrl?: string | null;
  localUploadState?: 'uploading' | null;
};
export type RealmChatTimelineDisplayModel = {
  isMe: boolean;
  kind: 'text' | 'gift' | 'image' | 'video';
  isGiftMessage: boolean;
  isImageMessage: boolean;
  isVideoMessage: boolean;
  isMediaMessage: boolean;
  resolvedText: string;
  localPreviewUrl: string | null;
  isUploadingMedia: boolean;
  showDeliveryState: boolean;
  deliveryState: RealmChatTimelineMessage['deliveryState'];
  deliveryError: string | null;
};
export type RealmChatOutboxEntryLike = {
  clientMessageId: string;
  chatId: string;
  body?: unknown;
  enqueuedAt: number;
  status: 'pending' | 'failed' | 'sent' | string;
  failReason?: string | null;
};
export type RealmChatUploadPlaceholderLike = {
  id: string;
  chatId: string;
  previewUrl: string;
  kind: 'image' | 'video' | string;
  senderId: string;
  createdAt: string;
};
export type UseRealmMessageTimelineOptions = {
  messagesData?: {
    items?: readonly RealmMessageViewDto[];
    offlineOutbox?: readonly RealmChatOutboxEntryLike[];
  } | null;
  currentUserId: string;
  uploadPlaceholders?: readonly RealmChatUploadPlaceholderLike[];
};

export type RealmChatService = {
  listChats: (limit?: number, cursor?: string) => Promise<RealmListChatsResultDto>;
  getChatById: (chatId: string) => Promise<RealmChatViewDto>;
  startChat: (input: RealmStartChatInputDto) => Promise<RealmStartChatResultDto>;
  listMessages: (
    chatId: string,
    limit?: number,
    cursor?: string,
  ) => Promise<RealmListMessagesResultDto>;
  sendMessage: (
    chatId: string,
    input: RealmSendMessageInputDto,
  ) => Promise<RealmMessageViewDto>;
  markChatRead: (chatId: string) => Promise<void>;
  syncChatEvents: (
    chatId: string,
    afterSeq: number,
    limit?: number,
  ) => Promise<RealmChatSyncResultDto>;
};

export type RealmChatSendService = Pick<RealmChatService, 'sendMessage'>;
export type UseRealmChatRealtimeControllerOptions = {
  authStatus: string;
  authToken?: string | null;
  fallbackToken?: string | null;
  realtimeBaseUrl?: string | null;
  selectedChatId: string | null;
  currentUserId: string;
  socketPath?: string;
  createSocket: RealmChatRealtimeSocketFactory;
  onSocketReachableChange?: (reachable: boolean) => void;
  flushChatOutbox?: () => Promise<void> | void;
  flushSocialOutbox?: () => Promise<void> | void;
  invalidateChats?: () => Promise<void> | void;
  invalidateMessages?: (chatId: string) => Promise<void> | void;
  invalidateNotifications?: () => Promise<void> | void;
  syncChatEvents: (
    chatId: string,
    afterSeq: number,
    limit: number,
  ) => Promise<RealmChatSyncResultDto>;
  loadMessages: (chatId: string) => Promise<unknown>;
  applyChatEvent: (input: {
    event: RealmChatEventEnvelope;
    selectedChatId: string | null;
    currentUserId: string;
  }) => void;
  applySyncSnapshot: (
    chatId: string,
    snapshot: RealmChatSyncResultDto['snapshot'],
  ) => void;
};

export type RealmChatComposerAdapterOptions<TAttachment = never> = {
  chatId: string;
  service?: RealmChatSendService;
  messageOptions?: Partial<RealmSendMessageInputDto>;
  resolveMessageInput?: (
    input: ChatComposerSubmitInput<TAttachment>,
  ) => RealmSendMessageInputDto | Promise<RealmSendMessageInputDto>;
  onResponse?: (
    message: RealmMessageViewDto,
    input: ChatComposerSubmitInput<TAttachment>,
  ) => Promise<void> | void;
};

export type UseRealmChatComposerOptions<TAttachment = never> =
  Omit<UseChatComposerOptions<TAttachment>, 'adapter'>
  & RealmChatComposerAdapterOptions<TAttachment>;

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

function createCanonicalTextPayload(content: string): Record<string, unknown> {
  return { content };
}

function normalizeDateString(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeMessageType(value: unknown): RealmMessageViewDto['type'] | null {
  const normalized = normalizeString(value);
  const allowed = new Set<RealmMessageViewDto['type']>([
    'TEXT',
    'ATTACHMENT',
    'POST_REF',
    'USER_REF',
    'LINK_REF',
    'GIFT',
    'FRIEND_REQUEST',
    'SYSTEM',
    'RECALL',
  ]);
  return allowed.has(normalized as RealmMessageViewDto['type'])
    ? (normalized as RealmMessageViewDto['type'])
    : null;
}

function normalizePayload(input: unknown): Record<string, unknown> | null {
  if (input === null) {
    return null;
  }
  return asRecord(input);
}

function normalizeReplyTo(input: unknown): RealmMessageViewDto['replyTo'] {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  const id = normalizeString(record.id);
  const senderId = normalizeString(record.senderId);
  const type = normalizeString(record.type);
  if (!id || !senderId || !type) {
    return undefined;
  }
  const textValue = record.text;
  return {
    id,
    senderId,
    type,
    text: typeof textValue === 'string' ? textValue : '',
    payload: normalizePayload(record.payload),
  };
}

function resolveMessageTimestamp(message: RealmMessageViewDto): number {
  const timestamp = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveTimelineMessageTimestamp(message: RealmChatTimelineMessage): number {
  const timestamp = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareMessageDesc(left: RealmMessageViewDto, right: RealmMessageViewDto): number {
  const timeDiff = resolveMessageTimestamp(right) - resolveMessageTimestamp(left);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return String(right.id || '').localeCompare(String(left.id || ''));
}

function sameMessageIdentity(left: RealmMessageViewDto, right: RealmMessageViewDto): boolean {
  if (String(left.id || '') === String(right.id || '')) {
    return true;
  }
  const leftClientMessageId = normalizeString(left.clientMessageId);
  const rightClientMessageId = normalizeString(right.clientMessageId);
  return Boolean(
    leftClientMessageId
    && rightClientMessageId
    && leftClientMessageId === rightClientMessageId,
  );
}

function shouldUseIncomingMessage(
  current: RealmMessageViewDto,
  incoming: RealmMessageViewDto,
): boolean {
  return resolveMessageTimestamp(incoming) >= resolveMessageTimestamp(current);
}

function moveChatToTop(
  items: RealmChatViewDto[],
  index: number,
  nextChat: RealmChatViewDto,
): RealmChatViewDto[] {
  if (index <= 0) {
    const cloned = items.slice();
    cloned[0] = nextChat;
    return cloned;
  }
  const nextItems = items.slice();
  nextItems.splice(index, 1);
  nextItems.unshift(nextChat);
  return nextItems;
}

export function buildRealmTextMessageInput(
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

export function rememberRealmChatSeenEvent(
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

export function normalizeRealmChatEventEnvelope(
  payload: RealmChatEventEnvelopeDto,
): RealmChatEventEnvelope | null {
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

export function parseRealmSocketChatEvent(payload: unknown): RealmChatEventEnvelope | null {
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
  const eventPayload = asRecord(record.payload) ?? {};
  return {
    actorId: normalizeString(record.actorId),
    seq,
    eventId,
    chatId,
    kind,
    occurredAt: normalizeString(record.occurredAt),
    payload: eventPayload as RealmChatEventEnvelopeDto['payload'],
    sessionId: normalizeString(record.sessionId),
  };
}

export function parseRealmChatSessionReadyPayload(
  payload: unknown,
): RealmChatSessionReadyPayload | null {
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
  return {
    chatId,
    sessionId,
    resumeToken,
    lastAckSeq,
  };
}

export function parseRealmChatSyncRequiredPayload(
  payload: unknown,
): RealmChatSessionSyncRequiredPayload | null {
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

export function getRealmReplayMaxSeq(
  events: readonly RealmChatEventEnvelopeDto[],
  fallbackSeq: number,
): number {
  return events.reduce((maxSeq, candidate) => {
    const normalized = normalizeRealmChatEventEnvelope(candidate);
    if (!normalized) {
      return maxSeq;
    }
    return Math.max(maxSeq, normalized.seq);
  }, fallbackSeq);
}

export function normalizeRealmRealtimeMessagePayload(
  payload: unknown,
): RealmMessageViewDto | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const id = normalizeString(record.id);
  const chatId = normalizeString(record.chatId || record.roomId);
  const senderId = normalizeString(record.senderId);
  const type = normalizeMessageType(record.type);
  if (!id || !chatId || !senderId || !type) {
    return null;
  }

  const textValue = record.text;
  const normalized: RealmMessageViewDto = {
    id,
    chatId,
    senderId,
    type,
    clientMessageId: normalizeString(record.clientMessageId) || undefined,
    payload: normalizePayload(record.payload),
    text:
      typeof textValue === 'string' || textValue === null
        ? (textValue as string | null)
        : undefined,
    isRead: Boolean(record.isRead),
    createdAt: normalizeDateString(record.createdAt),
  };
  const replyTo = normalizeReplyTo(record.replyTo);
  if (replyTo) {
    normalized.replyTo = replyTo;
  }
  return normalized;
}

export function createRealmChatSessionState(
  payload: RealmChatSessionReadyPayload,
): RealmChatSessionState {
  return {
    chatId: payload.chatId,
    sessionId: payload.sessionId,
    resumeToken: payload.resumeToken,
    lastAckSeq: payload.lastAckSeq,
  };
}

export function createRealmChatSessionOpenPayload(
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

export function advanceRealmChatSessionAck(
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
    nextSession: {
      ...session,
      lastAckSeq: event.seq,
    },
    ackPayload: {
      chatId: session.chatId,
      sessionId: session.sessionId,
      ackSeq: event.seq,
    },
  };
}

export function resolveRealmChatSyncRequest(input: {
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
  if (!payload) {
    return;
  }
  socket.emit('chat:session.open', payload);
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

export function extractRealmMessageFromEvent(
  event: RealmChatEventEnvelope,
): RealmMessageViewDto | null {
  const payload = asRecord(event.payload);
  const candidate = payload ? asRecord(payload.message) : null;
  return candidate ? normalizeRealmRealtimeMessagePayload(candidate) : null;
}

function upsertMessageDescending(
  items: RealmMessageViewDto[],
  message: RealmMessageViewDto,
): RealmMessageViewDto[] {
  const existing = items.find((item) => sameMessageIdentity(item, message));
  const deduped = items.filter((item) => !sameMessageIdentity(item, message));
  deduped.push(existing && !shouldUseIncomingMessage(existing, message) ? existing : message);
  deduped.sort(compareMessageDesc);
  return deduped;
}

export function mergeRealmRealtimeMessageIntoMessagesResult(
  current: RealmListMessagesResultDto | undefined,
  message: RealmMessageViewDto,
): RealmListMessagesResultDto {
  const items = Array.isArray(current?.items) ? current.items : [];
  return {
    items: upsertMessageDescending(items, message),
    nextBefore: current?.nextBefore ?? null,
    nextAfter: current?.nextAfter ?? null,
  };
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

export function toRealmChatTimelineOutboxMessage(
  entry: RealmChatOutboxEntryLike,
  fallbackSenderId: string,
): RealmChatTimelineMessage {
  const body = asRecord(entry.body) ?? {};
  const payload = asRecord(body.payload);
  const type = normalizeString(body.type).toUpperCase() || 'TEXT';
  return {
    id: `offline:${entry.clientMessageId}`,
    chatId: entry.chatId,
    clientMessageId: entry.clientMessageId,
    createdAt: new Date(entry.enqueuedAt).toISOString(),
    isRead: true,
    payload: payload ?? null,
    senderId: fallbackSenderId || normalizeString(body.senderId) || 'local-user',
    text: typeof body.text === 'string' ? body.text : null,
    type: type as RealmMessageViewDto['type'],
    deliveryState: entry.status === 'failed' ? 'failed' : entry.status === 'sent' ? 'sent' : 'pending',
    deliveryError: typeof entry.failReason === 'string' ? entry.failReason : null,
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

export function sameRealmChatTimelineIdentity(
  left: Pick<RealmMessageViewDto, 'id' | 'clientMessageId'>,
  right: Pick<RealmMessageViewDto, 'id' | 'clientMessageId'>,
): boolean {
  return sameMessageIdentity(left as RealmMessageViewDto, right as RealmMessageViewDto);
}

export function resolveRealmMessageText(message: Pick<RealmMessageViewDto, 'text' | 'payload'>): string {
  const text = normalizeString(message.text);
  if (text) {
    return text;
  }
  const payload = asRecord(message.payload);
  const payloadText = normalizeString(payload?.content || payload?.text || '');
  if (payloadText) {
    return payloadText;
  }
  const attachment = asRecord(payload?.attachment);
  const preview = asRecord(attachment?.preview);
  const attachmentTitle = normalizeString(attachment?.title || attachment?.subtitle);
  if (attachmentTitle) {
    return attachmentTitle;
  }
  const previewTitle = normalizeString(preview?.title || preview?.subtitle);
  if (previewTitle) {
    return previewTitle;
  }
  const displayKind = normalizeString(preview?.displayKind || attachment?.displayKind).toUpperCase();
  switch (displayKind) {
    case 'IMAGE':
      return 'Image';
    case 'VIDEO':
      return 'Video';
    case 'AUDIO':
      return 'Audio';
    case 'TEXT':
      return 'Text';
    case 'CARD':
      return 'Attachment';
    default:
      return '';
  }
}

function resolveTimelineAttachmentRecord(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  const attachment = asRecord(record?.attachment);
  if (!attachment) {
    return null;
  }
  const attachmentDisplayKind = normalizeString(attachment.displayKind).toUpperCase();
  if (attachmentDisplayKind === 'IMAGE' || attachmentDisplayKind === 'VIDEO') {
    return attachment;
  }
  const preview = asRecord(attachment.preview);
  const previewDisplayKind = normalizeString(preview?.displayKind).toUpperCase();
  if (preview && (previewDisplayKind === 'IMAGE' || previewDisplayKind === 'VIDEO')) {
    return preview;
  }
  return attachment;
}

export function resolveRealmChatMediaUrl(payload: unknown, realmBaseUrl: string): string {
  const record = asRecord(payload);
  const attachment = resolveTimelineAttachmentRecord(payload);
  const url = normalizeString(attachment?.url || record?.url);
  if (!url) {
    return '';
  }
  if (url.startsWith('/')) {
    const normalizedBaseUrl = normalizeString(realmBaseUrl).replace(/\/$/, '');
    return normalizedBaseUrl ? `${normalizedBaseUrl}${url}` : url;
  }
  return url;
}

export function getRealmChatTimelineDisplayModel(
  message: RealmChatTimelineMessage,
  currentUserId: string,
): RealmChatTimelineDisplayModel {
  const type = normalizeString(message.type).toUpperCase();
  const attachment = resolveTimelineAttachmentRecord(message.payload);
  const displayKind = normalizeString(attachment?.displayKind).toUpperCase();
  const isGiftMessage = type === 'GIFT';
  const isAttachmentMessage = type === 'ATTACHMENT';
  const isImageMessage = type === 'IMAGE' || (isAttachmentMessage && displayKind === 'IMAGE');
  const isVideoMessage = type === 'VIDEO' || (isAttachmentMessage && displayKind === 'VIDEO');
  const isMediaMessage = isImageMessage || isVideoMessage;
  return {
    isMe: message.deliveryState !== 'sent' || message.senderId === currentUserId,
    kind: isGiftMessage ? 'gift' : isImageMessage ? 'image' : isVideoMessage ? 'video' : 'text',
    isGiftMessage,
    isImageMessage,
    isVideoMessage,
    isMediaMessage,
    resolvedText: resolveRealmMessageText(message),
    localPreviewUrl: message.localPreviewUrl || null,
    isUploadingMedia: message.localUploadState === 'uploading',
    showDeliveryState: message.deliveryState !== 'sent',
    deliveryState: message.deliveryState,
    deliveryError: message.deliveryError || null,
  };
}

export function useRealmMessageTimeline({
  messagesData,
  currentUserId,
  uploadPlaceholders = [],
}: UseRealmMessageTimelineOptions): readonly RealmChatTimelineMessage[] {
  return useMemo(() => {
    const remoteItems = (Array.isArray(messagesData?.items) ? messagesData.items : [])
      .map((message) => toRealmChatTimelineRemoteMessage(message));
    const offlineOutbox = Array.isArray(messagesData?.offlineOutbox) ? messagesData.offlineOutbox : [];
    const merged: RealmChatTimelineMessage[] = remoteItems.slice();
    for (const entry of offlineOutbox) {
      const placeholder = toRealmChatTimelineOutboxMessage(entry, currentUserId);
      if (merged.some((message) => sameRealmChatTimelineIdentity(message, placeholder))) {
        continue;
      }
      merged.push(placeholder);
    }
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
  }, [currentUserId, messagesData, uploadPlaceholders]);
}

export function applyRealmRealtimeMessageUpdateToMessagesResult(
  current: RealmListMessagesResultDto | undefined,
  message: RealmMessageViewDto,
): RealmListMessagesResultDto | undefined {
  if (!current || !Array.isArray(current.items) || current.items.length === 0) {
    return current;
  }

  let updated = false;
  const nextItems = current.items.map((item) => {
    if (!sameMessageIdentity(item, message)) {
      return item;
    }
    if (!shouldUseIncomingMessage(item, message)) {
      return item;
    }
    updated = true;
    return {
      ...item,
      ...message,
    };
  });

  if (!updated) {
    return current;
  }

  return {
    ...current,
    items: nextItems,
  };
}

export function applyRealmRealtimeMessageToChatsResult(input: {
  current: RealmListChatsResultDto | undefined;
  message: RealmMessageViewDto;
  currentUserId: string;
  selectedChatId: string | null;
}): { data: RealmListChatsResultDto | undefined; found: boolean; shouldMarkRead: boolean } {
  const items = Array.isArray(input.current?.items) ? input.current.items : [];
  if (items.length === 0) {
    return { data: input.current, found: false, shouldMarkRead: false };
  }

  const chatIndex = items.findIndex(
    (item) => String(item.id || '') === String(input.message.chatId || ''),
  );
  if (chatIndex < 0) {
    return { data: input.current, found: false, shouldMarkRead: false };
  }

  const previous = items[chatIndex]!;
  const isSelected = input.selectedChatId === input.message.chatId;
  const hasCurrentUser = Boolean(input.currentUserId);
  const isFromOther = hasCurrentUser && input.message.senderId !== input.currentUserId;
  const nextUnreadCount = isFromOther && !isSelected
    ? Math.max(0, Number(previous.unreadCount || 0) + 1)
    : 0;
  const nextChat: RealmChatViewDto = {
    ...previous,
    lastMessage: input.message,
    lastMessageAt: input.message.createdAt,
    unreadCount: nextUnreadCount,
  };

  return {
    data: input.current
      ? {
        ...input.current,
        items: moveChatToTop(items, chatIndex, nextChat),
      }
      : input.current,
    found: true,
    shouldMarkRead: Boolean(isFromOther && isSelected),
  };
}

export function applyRealmRealtimeMessageUpdateToChatsResult(input: {
  current: RealmListChatsResultDto | undefined;
  chatId: string;
  message: RealmMessageViewDto;
}): { data: RealmListChatsResultDto | undefined; found: boolean } {
  const items = Array.isArray(input.current?.items) ? input.current.items : [];
  if (items.length === 0) {
    return { data: input.current, found: false };
  }
  const chatIndex = items.findIndex(
    (item) => String(item.id || '') === String(input.chatId || ''),
  );
  if (chatIndex < 0) {
    return { data: input.current, found: false };
  }

  const chat = items[chatIndex]!;
  if (String(chat.lastMessage?.id || '') !== String(input.message.id || '')) {
    return { data: input.current, found: true };
  }
  if (chat.lastMessage && !shouldUseIncomingMessage(chat.lastMessage, input.message)) {
    return { data: input.current, found: true };
  }

  const nextChat: RealmChatViewDto = {
    ...chat,
    lastMessage: {
      ...chat.lastMessage,
      ...input.message,
    },
  };
  const nextItems = items.slice();
  nextItems[chatIndex] = nextChat;
  return {
    data: input.current
      ? {
        ...input.current,
        items: nextItems,
      }
      : input.current,
    found: true,
  };
}

export const realmChatService: RealmChatService = {
  async listChats(limit = 20, cursor) {
    return realm().services.HumanChatsService.listChats(
      normalizeLimit(limit, 20, 100),
      cursor,
    );
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

export async function listRealmChats(
  limit = 20,
  cursor?: string,
  service: RealmChatService = realmChatService,
): Promise<RealmListChatsResultDto> {
  return service.listChats(limit, cursor);
}

export async function getRealmChat(
  chatId: string,
  service: RealmChatService = realmChatService,
): Promise<RealmChatViewDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.getChatById(normalizedChatId);
}

export async function startRealmChat(
  input: RealmStartChatInputDto,
  service: RealmChatService = realmChatService,
): Promise<RealmStartChatResultDto> {
  return service.startChat(input);
}

export async function listRealmChatMessages(
  chatId: string,
  limit = 50,
  cursor?: string,
  service: RealmChatService = realmChatService,
): Promise<RealmListMessagesResultDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  return service.listMessages(normalizedChatId, limit, cursor);
}

export async function sendRealmChatMessage(
  chatId: string,
  input: string | RealmSendMessageInputDto,
  service: RealmChatService = realmChatService,
): Promise<RealmMessageViewDto> {
  const normalizedChatId = normalizeChatId(chatId);
  if (!normalizedChatId) {
    throw new Error('Chat id is required');
  }
  const payload = typeof input === 'string' ? buildRealmTextMessageInput(input) : input;
  return service.sendMessage(normalizedChatId, payload);
}

export async function markRealmChatRead(
  chatId: string,
  service: RealmChatService = realmChatService,
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
  service: RealmChatService = realmChatService,
): Promise<RealmChatSyncResultDto> {
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
}: RealmChatComposerAdapterOptions<TAttachment>): ChatComposerAdapter<TAttachment> {
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
        ackRealmChatEventOnSocket(socket, sessionRef.current, event, (nextSession) => {
          setSession(nextSession);
        });
        return;
      }
      callbacksRef.current.applyChatEvent({
        event,
        selectedChatId: selectedChatIdRef.current,
        currentUserId: currentUserIdRef.current,
      });
      ackRealmChatEventOnSocket(socket, sessionRef.current, event, (nextSession) => {
        setSession(nextSession);
      });
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
              if (!event) {
                continue;
              }
              if (rememberRealmChatSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) {
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
                if (!event) continue;
                if (rememberRealmChatSeenEvent(seenEventsRef.current, `chat:event:${event.eventId}`)) continue;
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
