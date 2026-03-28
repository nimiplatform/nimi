import { useMemo } from 'react';
import { normalizeRealmMessagePayload } from './headless.js';
import type { RealmMessageInputPayload, RealmMessageViewDto, RealmSendMessageInputDto } from './realm/codec.js';
export type { RealmMessageInputPayload, RealmMessagePayload, RealmMessageViewDto, RealmSendMessageInputDto } from './realm/codec.js';
export * from './realm-service.js';
export type * from './realm-types.js';
import type { RealmChatEventEnvelope, RealmChatEventEnvelopeDto, RealmChatOutboxEntryLike, RealmChatRealtimeSocket, RealmChatSessionReadyPayload, RealmChatSessionState, RealmChatSessionSyncRequiredPayload, RealmChatTimelineDisplayModel, RealmChatTimelineMessage, RealmChatUploadPlaceholderLike, RealmChatViewDto, RealmListChatsResultDto, RealmListMessagesResultDto, UseRealmMessageTimelineOptions } from './realm-types.js';

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

function createCanonicalTextPayload(
  content: string,
): Extract<RealmMessageInputPayload, { content: string }> {
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
    payload: normalizeRealmMessagePayload(record.payload),
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
    payload: normalizeRealmMessagePayload(record.payload),
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
    payload: normalizeRealmMessagePayload(payload),
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
