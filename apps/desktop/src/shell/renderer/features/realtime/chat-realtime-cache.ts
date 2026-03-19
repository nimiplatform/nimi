import type { RealmModel } from '@nimiplatform/sdk/realm';

type ChatViewDto = RealmModel<'ChatViewDto'>;
type ListChatsResultDto = RealmModel<'ListChatsResultDto'>;
type ListMessagesResultDto = RealmModel<'ListMessagesResultDto'>;
type MessageViewDto = RealmModel<'MessageViewDto'>;

export type NormalizedChatUpdatePayload = {
  chatId: string;
  message: MessageViewDto;
};

type ChatMergeInput = {
  current: ListChatsResultDto | undefined;
  message: MessageViewDto;
  currentUserId: string;
  selectedChatId: string | null;
};

type ChatMergeResult = {
  data: ListChatsResultDto | undefined;
  found: boolean;
  shouldMarkRead: boolean;
};

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  return input as Record<string, unknown>;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function resolveMessageTimestamp(message: MessageViewDto): number {
  const timestamp = Date.parse(String(message.createdAt || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareMessageDesc(left: MessageViewDto, right: MessageViewDto): number {
  const timeDiff = resolveMessageTimestamp(right) - resolveMessageTimestamp(left);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return String(right.id || '').localeCompare(String(left.id || ''));
}

function sameMessageIdentity(left: MessageViewDto, right: MessageViewDto): boolean {
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
  current: MessageViewDto,
  incoming: MessageViewDto,
): boolean {
  return resolveMessageTimestamp(incoming) >= resolveMessageTimestamp(current);
}

function pickLatestMessageByServerTimestamp(
  current: MessageViewDto,
  incoming: MessageViewDto,
): MessageViewDto {
  return shouldUseIncomingMessage(current, incoming) ? incoming : current;
}

function normalizeReplyTo(input: unknown): MessageViewDto['replyTo'] {
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
  const payloadValue = record.payload;
  return {
    id,
    senderId,
    type,
    text: typeof textValue === 'string' ? textValue : '',
    payload:
      payloadValue && typeof payloadValue === 'object'
        ? (payloadValue as Record<string, unknown>)
        : null,
  };
}

function normalizePayload(input: unknown): Record<string, unknown> | null {
  if (input === null) {
    return null;
  }
  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return null;
}

export function normalizeRealtimeMessagePayload(payload: unknown): MessageViewDto | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const id = normalizeString(record.id);
  const chatId = normalizeString(record.chatId || record.roomId);
  const senderId = normalizeString(record.senderId);
  const type = normalizeString(record.type);
  if (!id || !chatId || !senderId || !type) {
    return null;
  }

  const createdAt = normalizeDateString(record.createdAt);
  const textValue = record.text;
  const isReadValue = record.isRead;
  const normalized: MessageViewDto = {
    id,
    chatId,
    senderId,
    type: type as MessageViewDto['type'],
    clientMessageId: normalizeString(record.clientMessageId) || undefined,
    payload: normalizePayload(record.payload),
    text:
      typeof textValue === 'string' || textValue === null
        ? (textValue as string | null)
        : undefined,
    isRead: Boolean(isReadValue),
    createdAt,
  };
  const replyTo = normalizeReplyTo(record.replyTo);
  if (replyTo) {
    normalized.replyTo = replyTo;
  }
  return normalized;
}

export function normalizeRealtimeChatUpdatePayload(
  payload: unknown,
): NormalizedChatUpdatePayload | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const message = normalizeRealtimeMessagePayload(record.payload || record.message || payload);
  if (!message) {
    return null;
  }
  const roomId = normalizeString(record.roomId || record.chatId || message.chatId);
  if (!roomId) {
    return null;
  }
  return {
    chatId: roomId,
    message: message.chatId === roomId ? message : { ...message, chatId: roomId },
  };
}

function upsertMessageDescending(items: MessageViewDto[], message: MessageViewDto): MessageViewDto[] {
  const existing = items.find((item) => sameMessageIdentity(item, message));
  const deduped = items.filter((item) => !sameMessageIdentity(item, message));
  deduped.push(existing ? pickLatestMessageByServerTimestamp(existing, message) : message);
  deduped.sort(compareMessageDesc);
  return deduped;
}

export function mergeRealtimeMessageIntoMessagesResult(
  current: ListMessagesResultDto | undefined,
  message: MessageViewDto,
): ListMessagesResultDto {
  const items = Array.isArray(current?.items) ? current.items : [];
  return {
    items: upsertMessageDescending(items, message),
    nextBefore: current?.nextBefore ?? null,
    nextAfter: current?.nextAfter ?? null,
  };
}

export function applyRealtimeMessageUpdateToMessagesResult(
  current: ListMessagesResultDto | undefined,
  message: MessageViewDto,
): ListMessagesResultDto | undefined {
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

function moveChatToTop(
  items: ChatViewDto[],
  index: number,
  nextChat: ChatViewDto,
): ChatViewDto[] {
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

export function applyRealtimeMessageToChatsResult(
  input: ChatMergeInput,
): ChatMergeResult {
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
  const nextUnreadCount = isFromOther && !isSelected ? Math.max(0, Number(previous.unreadCount || 0) + 1) : 0;
  const nextChat: ChatViewDto = {
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

export function applyRealtimeMessageUpdateToChatsResult(input: {
  current: ListChatsResultDto | undefined;
  chatId: string;
  message: MessageViewDto;
}): { data: ListChatsResultDto | undefined; found: boolean } {
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

  const nextChat: ChatViewDto = {
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
