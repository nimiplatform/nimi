import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { normalizeRealmMessagePayload } from '@nimiplatform/nimi-kit/features/chat/headless';
import { isJsonObject, type JsonObject } from '@runtime/net/json';
import {
  getErrorMessage,
  getOfflineCacheManager,
  getOfflineCoordinator,
  isRealmOfflineError,
  type PersistentOutboxEntry,
} from '@runtime/offline';

type MessageType = RealmModel<'MessageType'>;
type SendMessageInputDto = RealmModel<'SendMessageInputDto'>;
type StartChatInputDto = RealmModel<'StartChatInputDto'>;
type ChatSyncResultDto = RealmModel<'ChatSyncResultDto'>;
type MessageViewDto = RealmModel<'MessageViewDto'>;

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

function isHumanChatThread(chat: unknown): boolean {
  if (!chat || typeof chat !== 'object') {
    return false;
  }
  const otherUser = (chat as { otherUser?: unknown }).otherUser;
  if (!otherUser || typeof otherUser !== 'object') {
    return true;
  }
  return (otherUser as { isAgent?: unknown }).isAgent !== true;
}

function filterHumanChatItems<T>(items: T[] | undefined): T[] {
  return Array.isArray(items) ? items.filter((item) => isHumanChatThread(item)) : [];
}

type PendingChatOutboxEntry = {
  chatId: string;
  body: SendMessageInputDto;
  queuedAt: number;
  attempts: number;
};

function createClientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createCanonicalTextPayload(
  content: string,
): Extract<NonNullable<SendMessageInputDto['payload']>, { content: string }> {
  return { content };
}

function toPersistentEntry(entry: PendingChatOutboxEntry): PersistentOutboxEntry {
  return {
    clientMessageId: String(entry.body.clientMessageId || '').trim(),
    chatId: entry.chatId,
    body: entry.body as JsonObject,
    enqueuedAt: entry.queuedAt,
    attempts: entry.attempts,
    status: 'pending',
  };
}

function toQueuedMessagePlaceholder(entry: PersistentOutboxEntry): MessageViewDto {
  const payload = isJsonObject(entry.body.payload)
    ? entry.body.payload
    : null;
  return {
    id: `offline:${entry.clientMessageId}`,
    chatId: entry.chatId,
    clientMessageId: entry.clientMessageId,
    createdAt: new Date(entry.enqueuedAt).toISOString(),
    isRead: true,
    payload: normalizeRealmMessagePayload(payload),
    senderId: String(entry.body.senderId || 'local-user'),
    text: typeof entry.body.text === 'string' ? entry.body.text : null,
    type: (entry.body.type || 'TEXT') as MessageType,
  };
}

export function buildOfflineOutboxMessage(entry: PersistentOutboxEntry): MessageViewDto {
  return toQueuedMessagePlaceholder(entry);
}

export async function countPendingChatOutboxEntries(): Promise<number> {
  const manager = await getOfflineCacheManager();
  const entries = await manager.getChatOutboxEntries();
  return entries.filter((entry) => entry.status === 'pending').length;
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
      (realm) => realm.services.HumanChatsService.listChats(limit),
      '加载会话列表失败',
    );
    const manager = await getOfflineCacheManager();
    const items = filterHumanChatItems(result?.items);
    await manager.syncChatList(items);
    return {
      ...result,
      items,
    };
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const manager = await getOfflineCacheManager();
      getOfflineCoordinator().markCacheFallbackUsed();
      return {
        items: filterHumanChatItems(await manager.getCachedChatList()),
      };
    }
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
      (realm) => realm.services.HumanChatsService.listChats(20, cursor),
      '加载更多会话失败',
    );
    return {
      ...result,
      items: filterHumanChatItems(result?.items),
    };
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
      data.payload = createCanonicalTextPayload(normalizedMessage) as StartChatInputDto['payload'];
    }

    const result = await callApi(
      (realm) => realm.services.HumanChatsService.startChat(data),
      '创建会话失败',
    );
    const chat = await callApi(
      (realm) => realm.services.HumanChatsService.getChatById(result.chatId),
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
      (realm) => realm.services.HumanChatsService.listMessages(chatId, limit),
      '加载消息失败',
    );
    const manager = await getOfflineCacheManager();
    const items = Array.isArray(result?.items) ? result.items : [];
    await manager.syncChatMessages(chatId, items);
    if (markChatRead) {
      await markChatRead(chatId);
    }
    return {
      ...result,
      offlineOutbox: await manager.getChatOutboxEntries(chatId),
    };
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const manager = await getOfflineCacheManager();
      getOfflineCoordinator().markCacheFallbackUsed();
      return {
        items: await manager.getCachedMessages<MessageViewDto>(chatId),
        offlineOutbox: await manager.getChatOutboxEntries(chatId),
      };
    }
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
      (realm) => realm.services.HumanChatsService.listMessages(
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
      payload: createCanonicalTextPayload(content),
      ...options,
    };
    const manager = await getOfflineCacheManager();
    const entry = toPersistentEntry({
      chatId,
      body: data,
      queuedAt: Date.now(),
      attempts: 0,
    });
    await manager.upsertChatOutboxEntry(entry);

    const message = await callApi(
      (realm) => realm.services.HumanChatsService.sendMessage(chatId, data),
      '发送消息失败',
    );
    await manager.markChatOutboxSent(data.clientMessageId);
    return message;
  } catch (error) {
    const manager = await getOfflineCacheManager();
    const existing = await manager.getChatOutboxEntry(clientMessageId);
    if (existing && isRealmOfflineError(error)) {
      await manager.upsertChatOutboxEntry({
        ...existing,
        attempts: existing.attempts + 1,
      });
      getOfflineCoordinator().markRealmRestReachable(false);
      return toQueuedMessagePlaceholder({
        ...existing,
        attempts: existing.attempts + 1,
      });
    }
    if (existing) {
      await manager.markChatOutboxFailed(
        clientMessageId,
        getErrorMessage(error, '发送消息失败'),
      );
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
  const manager = await getOfflineCacheManager();
  const pending = await manager.getChatOutboxEntries(chatId);
  const flushed: MessageViewDto[] = [];
  for (const entry of pending) {
    if (entry.status !== 'pending') {
      continue;
    }
    try {
      const message = await callApi(
        (realm) => realm.services.HumanChatsService.sendMessage(entry.chatId, entry.body as SendMessageInputDto),
        '重放聊天消息失败',
      );
      await manager.markChatOutboxSent(entry.clientMessageId);
      flushed.push(message);
    } catch (error) {
      if (isRealmOfflineError(error)) {
        await manager.upsertChatOutboxEntry({
          ...entry,
          attempts: entry.attempts + 1,
        });
        getOfflineCoordinator().markRealmRestReachable(false);
        continue;
      }
      await manager.markChatOutboxFailed(
        entry.clientMessageId,
        getErrorMessage(error, '重放聊天消息失败'),
      );
      emitDataSyncError('flush-chat-outbox', error, {
        chatId: entry.chatId,
        clientMessageId: entry.clientMessageId,
      });
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
    await callApi((realm) => realm.services.HumanChatsService.markChatRead(chatId));
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
      (realm) => realm.services.HumanChatsService.syncChatEvents(chatId, normalizedLimit, normalizedAfterSeq),
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
