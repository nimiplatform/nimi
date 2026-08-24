import { normalizeRealmMessagePayload, type RealmMessageInputPayload, type RealmMessageViewDto, type RealmSendMessageInputDto } from './codec.js';
import type {
  RealmChatTimelineMessage,
  RealmChatViewDto,
  RealmListChatsResultDto,
  RealmListMessagesResultDto,
} from './types.js';
import { asRecord, normalizeDateString, normalizeString, normalizeText } from './shared.js';

function createCanonicalTextPayload(
  content: string,
): Extract<RealmMessageInputPayload, { content: string }> {
  return { content };
}

function normalizeMessageType(value: unknown): RealmMessageViewDto['type'] | null {
  const normalized = normalizeString(value);
  const allowed = new Set<RealmMessageViewDto['type']>([
    'TEXT',
    'ATTACHMENT',
    'POST_REF',
    'USER_REF',
    'LINK_REF',
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
  const optionText = typeof options.text === 'string' ? options.text : undefined;
  const resolvedText = optionText && normalizeText(optionText) ? optionText : text;
  return {
    ...options,
    type: 'TEXT',
    text: resolvedText,
    payload: options.payload ?? createCanonicalTextPayload(text),
  } as RealmSendMessageInputDto;
}

export function normalizeRealmMessageView(
  payload: unknown,
): RealmMessageViewDto | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const id = normalizeString(record.id);
  const chatId = normalizeString(record.chatId);
  const senderId = normalizeString(record.senderId);
  const type = normalizeMessageType(record.type);
  if (!id || !chatId || !senderId || !type) {
    return null;
  }

  const textValue = record.text;
  const replyTo = normalizeReplyTo(record.replyTo);
  return {
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
    ...(replyTo ? { replyTo } : {}),
  };
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

export function mergeRealmMessageIntoMessagesResult(
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

export function sameRealmChatTimelineIdentity(
  left: Pick<RealmMessageViewDto, 'id' | 'clientMessageId'>,
  right: Pick<RealmMessageViewDto, 'id' | 'clientMessageId'>,
): boolean {
  return sameMessageIdentity(left as RealmMessageViewDto, right as RealmMessageViewDto);
}

export function applyRealmMessageUpdateToMessagesResult(
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

export function applyRealmMessageToChatsResult(input: {
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

export function applyRealmMessageUpdateToChatsResult(input: {
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
