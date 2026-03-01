import type { Realm } from '@nimiplatform/sdk/realm';
import type { MessageType } from '@nimiplatform/sdk/realm';
import type { SendMessageInputDto } from '@nimiplatform/sdk/realm';
import type { StartChatInputDto } from '@nimiplatform/sdk/realm';
import type { ChatSyncResultDto } from '@nimiplatform/sdk/realm';
import type { MessageViewDto } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
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

export function sameMessageIdentity(left: MessageViewDto, right: MessageViewDto): boolean {
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

export async function loadChatList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit = 20,
) {
  try {
    const result = await callApi(
      (realm) => realm.services.HumanChatService.listChats(limit),
      '加载会话列表失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-chats', error);
    throw error;
  }
}

export async function loadMoreChatList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  cursor?: string,
) {
  if (!cursor) return undefined;

  try {
    const result = await callApi(
      (realm) => realm.services.HumanChatService.listChats(20, cursor),
      '加载更多会话失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-more-chats', error);
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
      } as unknown as Record<string, never>;
    }

    const result = await callApi(
      (realm) => realm.services.HumanChatService.startChat(data),
      '创建会话失败',
    );
    const chat = await callApi(
      (realm) => realm.services.HumanChatService.getChatById(result.chatId),
      '加载新会话详情失败',
    );
    return { ...result, chat };
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
  markChatRead?: (chatId: string) => Promise<void>,
) {
  try {
    const result = await callApi(
      (realm) => realm.services.HumanChatService.listMessages(chatId, limit),
      '加载消息失败',
    );
    if (markChatRead) {
      await markChatRead(chatId);
    }
    return result;
  } catch (error) {
    emitDataSyncError('load-messages', error, { chatId });
    throw error;
  }
}

export async function loadMoreChatMessages(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  cursor?: string,
) {
  if (!cursor) return undefined;

  try {
    const result = await callApi(
      (realm) => realm.services.HumanChatService.listMessages(
        chatId,
        50,
        undefined,
        undefined,
        cursor,
      ),
      '加载更多消息失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-more-messages', error, { chatId });
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
      payload: { content } as unknown as Record<string, never>,
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
      (realm) => realm.services.HumanChatService.sendMessage(chatId, data),
      '发送消息失败',
    );
    outbox.delete(data.clientMessageId);
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
): Promise<MessageViewDto[]> {
  const normalizedChatId = String(chatId || '').trim();
  const targetChatIds = normalizedChatId
    ? [normalizedChatId]
    : Array.from(chatOutboxStore.keys());

  const flushed: MessageViewDto[] = [];

  for (const targetId of targetChatIds) {
    const outbox = getChatOutbox(targetId);
    if (outbox.size === 0) {
      continue;
    }

    const pending = Array.from(outbox.values()).sort((left, right) => left.queuedAt - right.queuedAt);
    for (const entry of pending) {
      try {
        const message = await callApi(
          (realm) => realm.services.HumanChatService.sendMessage(entry.chatId, entry.body),
          '重放聊天消息失败',
        );
        outbox.delete(entry.body.clientMessageId);
        flushed.push(message);
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

  return flushed;
}

export async function markChatAsRead(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
) {
  try {
    await callApi((realm) => realm.services.HumanChatService.markChatRead(chatId));
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
      (realm) => realm.services.HumanChatService.syncChatEvents(chatId, normalizedLimit, normalizedAfterSeq),
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
