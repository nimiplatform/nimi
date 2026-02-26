import { HumanChatService } from '@nimiplatform/sdk/realm';
import type { MessageType } from '@nimiplatform/sdk/realm';
import type { SendMessageInputDto } from '@nimiplatform/sdk/realm';
import type { StartChatInputDto } from '@nimiplatform/sdk/realm';
import type { ChatSyncResultDto } from '@nimiplatform/sdk/realm';
import type { MessageViewDto } from '@nimiplatform/sdk/realm';
import { store } from '@runtime/state';

type DataSyncApiCaller = <T>(task: () => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

type PendingChatOutboxEntry = {
  chatId: string;
  body: SendMessageInputDto;
  queuedAt: number;
  attempts: number;
};

const chatOutboxStore = new Map<string, Map<string, PendingChatOutboxEntry>>();

function createClientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getChatOutbox(chatId: string): Map<string, PendingChatOutboxEntry> {
  const normalized = String(chatId || '').trim();
  if (!normalized) {
    return new Map<string, PendingChatOutboxEntry>();
  }
  const existing = chatOutboxStore.get(normalized);
  if (existing) {
    return existing;
  }
  const created = new Map<string, PendingChatOutboxEntry>();
  chatOutboxStore.set(normalized, created);
  return created;
}

function sameMessageIdentity(left: MessageViewDto, right: MessageViewDto): boolean {
  if (String(left.id || '') === String(right.id || '')) {
    return true;
  }
  const leftClientMessageId = String(left.clientMessageId || '').trim();
  const rightClientMessageId = String(right.clientMessageId || '').trim();
  return Boolean(
    leftClientMessageId
    && rightClientMessageId
    && leftClientMessageId === rightClientMessageId,
  );
}

function upsertStoreMessage(chatId: string, message: MessageViewDto): void {
  const current = store.getMessages(chatId);
  const deduped = current.items.filter((item) => !sameMessageIdentity(item, message));
  deduped.unshift(message);
  deduped.sort((left, right) => {
    const leftTime = Date.parse(String(left.createdAt || ''));
    const rightTime = Date.parse(String(right.createdAt || ''));
    const delta = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    if (delta !== 0) {
      return delta;
    }
    return String(right.id || '').localeCompare(String(left.id || ''));
  });
  store.setMessages(chatId, deduped, current.cursor, current.hasMore);
}

export async function loadChatList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit = 20,
) {
  store.setChatsLoading(true);
  try {
    const result = await callApi(
      () => HumanChatService.listChats(limit),
      '加载会话列表失败',
    );
    const nextCursor = result.nextCursor ?? null;
    store.setChats(result.items || [], nextCursor, nextCursor !== null);
    return result;
  } catch (error) {
    emitDataSyncError('load-chats', error);
    store.setChatsLoading(false);
    throw error;
  }
}

export async function loadMoreChatList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  const chatsState =
    store.getState<{ cursor: string | null; isLoading: boolean }>('chats') ?? {
      cursor: null,
      isLoading: false,
    };
  const { cursor, isLoading } = chatsState;
  if (!cursor || isLoading) return undefined;

  store.setChatsLoading(true);
  try {
    const result = await callApi(
      () => HumanChatService.listChats(20, cursor || undefined),
      '加载更多会话失败',
    );
    const nextCursor = result.nextCursor ?? null;
    store.appendChats(result.items || [], nextCursor, nextCursor !== null);
    return result;
  } catch (error) {
    emitDataSyncError('load-more-chats', error);
    store.setChatsLoading(false);
    throw error;
  }
}

export async function startChatWithTarget(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  targetAccountId: string,
  initialMessage: string | null = null,
) {
  try {
    const data: StartChatInputDto = {
      targetAccountId,
    };
    const normalizedMessage = String(initialMessage || '').trim();
    if (normalizedMessage) {
      data.text = normalizedMessage;
      data.type = 'TEXT' as MessageType;
      data.payload = {
        content: normalizedMessage,
      };
    }

    const result = await callApi(
      () => HumanChatService.startChat(data),
      '创建会话失败',
    );
    const chat = await callApi(
      () => HumanChatService.getChatById(result.chatId),
      '加载新会话详情失败',
    );
    const chats = store.getState<Array<typeof chat>>('chats.items') ?? [];
    store.setChats([chat, ...chats]);
    return result;
  } catch (error) {
    emitDataSyncError('start-chat', error, {
      targetAccountId,
      hasInitialMessage: Boolean(initialMessage),
    });
    throw error;
  }
}

export async function loadChatMessages(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  limit: number,
  markChatRead: (chatId: string) => Promise<void>,
) {
  const messagesState = store.getMessages(chatId);
  if (messagesState.isLoading) return undefined;

  const chats = store.getState<{ items: Array<{ id: string; unreadCount?: number }> }>('chats');
  const chat = chats?.items?.find((item) => item.id === chatId);
  const hasUnread = (chat?.unreadCount ?? 0) > 0;

  store.setMessagesLoading(chatId, true);
  try {
    const result = await callApi(
      () => HumanChatService.listMessages(chatId, limit),
      '加载消息失败',
    );
    const nextBefore = result.nextBefore ?? null;
    store.setMessages(chatId, result.items || [], nextBefore || undefined, nextBefore !== null);
    if (hasUnread) {
      await markChatRead(chatId);
    }
    return result;
  } catch (error) {
    emitDataSyncError('load-messages', error, { chatId });
    store.setMessagesLoading(chatId, false);
    throw error;
  }
}

export async function loadMoreChatMessages(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
) {
  const messagesState = store.getMessages(chatId);
  if (!messagesState.cursor || messagesState.isLoading) return undefined;

  store.setMessagesLoading(chatId, true);
  try {
    const result = await callApi(
      () => HumanChatService.listMessages(
        chatId,
        50,
        undefined,
        undefined,
        messagesState.cursor || undefined,
      ),
      '加载更多消息失败',
    );
    const nextBefore = result.nextBefore ?? null;
    store.appendMessages(chatId, result.items || [], nextBefore, nextBefore !== null);
    return result;
  } catch (error) {
    emitDataSyncError('load-more-messages', error, { chatId });
    store.setMessagesLoading(chatId, false);
    throw error;
  }
}

export async function sendChatMessage(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  content: string,
  options: Partial<SendMessageInputDto>,
) {
  const clientMessageId = String(options.clientMessageId || '').trim() || createClientMessageId();
  try {
    const data: SendMessageInputDto = {
      clientMessageId,
      type: 'TEXT' as MessageType,
      text: content,
      payload: { content },
      ...options,
    };
    const outbox = getChatOutbox(chatId);
    outbox.set(data.clientMessageId, {
      chatId,
      body: data,
      queuedAt: Date.now(),
      attempts: 0,
    });

    const message = await callApi(
      () => HumanChatService.sendMessage(chatId, data),
      '发送消息失败',
    );
    outbox.delete(data.clientMessageId);
    upsertStoreMessage(chatId, message);
    return message;
  } catch (error) {
    const outbox = getChatOutbox(chatId);
    const existing = outbox.get(clientMessageId);
    if (existing) {
      existing.attempts += 1;
      outbox.set(clientMessageId, existing);
    }
    emitDataSyncError('send-message', error, { chatId });
    throw error;
  }
}

export async function flushPendingChatOutbox(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId?: string,
): Promise<void> {
  const normalizedChatId = String(chatId || '').trim();
  const targetChatIds = normalizedChatId
    ? [normalizedChatId]
    : Array.from(chatOutboxStore.keys());

  for (const targetId of targetChatIds) {
    const outbox = getChatOutbox(targetId);
    if (outbox.size === 0) {
      continue;
    }

    const pending = Array.from(outbox.values()).sort((left, right) => left.queuedAt - right.queuedAt);
    for (const entry of pending) {
      try {
        const message = await callApi(
          () => HumanChatService.sendMessage(entry.chatId, entry.body),
          '重放聊天消息失败',
        );
        outbox.delete(entry.body.clientMessageId);
        upsertStoreMessage(entry.chatId, message);
      } catch (error) {
        const latest = outbox.get(entry.body.clientMessageId);
        if (latest) {
          latest.attempts += 1;
          outbox.set(entry.body.clientMessageId, latest);
        }
        emitDataSyncError('flush-chat-outbox', error, {
          chatId: entry.chatId,
          clientMessageId: entry.body.clientMessageId,
        });
      }
    }
  }
}

export async function markChatAsRead(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
) {
  try {
    await callApi(() => HumanChatService.markChatRead(chatId));
    store.updateChat(chatId, { unreadCount: 0 });
  } catch (error) {
    emitDataSyncError('mark-chat-read', error, { chatId });
  }
}

export async function syncChatEventWindow(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  afterSeq: number,
  limit = 200,
): Promise<ChatSyncResultDto> {
  const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  const normalizedLimit = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 200;

  try {
    const result = await callApi(
      () => HumanChatService.syncChatEvents(chatId, normalizedLimit, normalizedAfterSeq),
      '同步聊天事件失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('sync-chat-events', error, {
      chatId,
      afterSeq: normalizedAfterSeq,
      limit: normalizedLimit,
    });
    throw error;
  }
}
