import type { RealmModel } from '@nimiplatform/sdk/realm';
import { createNimiClientId } from '@nimiplatform/sdk/runtime';
import {
  normalizeRealmMessagePayload,
  realmChatService,
  type RealmChatService,
} from '@nimiplatform/kit/features/chat/realm';
import {
  getNimiErrorMessage as getErrorMessage,
  isJsonObject,
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import {
  getOfflineCacheManager,
  getOfflineCoordinator,
  getOfflineOutboxManager,
  type PersistentOutboxEntry,
} from '@renderer/infra/offline';

type MessageType = RealmModel<'MessageType'>;
type SendMessageInputDto = RealmModel<'SendMessageInputDto'>;
type StartChatInputDto = RealmModel<'StartChatInputDto'>;
type ChatSyncResultDto = RealmModel<'ChatSyncResultDto'>;
type MessageViewDto = RealmModel<'MessageViewDto'>;

type DesktopChatErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

type DesktopRealmHumanChatService = RealmChatService;

function emitNoop() {}

function isHumanChatThread(chat: unknown): boolean {
  if (!chat || typeof chat !== 'object') {
    return false;
  }
  const otherUser = (chat as { otherUser?: unknown }).otherUser;
  if (!otherUser || typeof otherUser !== 'object') {
    return false;
  }
  return (otherUser as { isAgent?: unknown }).isAgent === false;
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
  return createNimiClientId('cm');
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
  const manager = await getOfflineOutboxManager();
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
  service: Pick<DesktopRealmHumanChatService, 'listChats'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
  limit = 20,
) {
  try {
    const result = await service.listChats(limit);
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
    emitChatError('load-chats', error);
    throw error;
  }
}

export async function loadMoreChatList(
  service: Pick<DesktopRealmHumanChatService, 'listChats'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
  cursor?: string,
) {
  if (!cursor) return undefined;

  try {
    const result = await service.listChats(20, cursor);
    return {
      ...result,
      items: filterHumanChatItems(result?.items),
    };
  } catch (error) {
    emitChatError('load-more-chats', error);
    throw error;
  }
}

export async function startChatWithTarget(
  targetAccountId: string,
  initialMessage: string | null = null,
  service: Pick<DesktopRealmHumanChatService, 'startChat' | 'getChatById'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
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

    const result = await service.startChat(data);
    const chat = await service.getChatById(result.chatId);
    return { ...result, chat };
  } catch (error) {
    emitChatError('start-chat', error, {
      targetAccountId,
      hasInitialMessage: Boolean(initialMessage),
    });
    throw error;
  }
}

export async function loadChatMessages(
  chatId: string,
  limit: number,
  markChatRead?: (chatId: string) => Promise<void>,
  service: Pick<DesktopRealmHumanChatService, 'listMessages'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
) {
  try {
    const result = await service.listMessages(chatId, limit);
    const cacheManager = await getOfflineCacheManager();
    const outboxManager = await getOfflineOutboxManager();
    const items = Array.isArray(result?.items) ? result.items : [];
    await cacheManager.syncChatMessages(chatId, items);
    if (markChatRead) {
      await markChatRead(chatId);
    }
    return {
      ...result,
      offlineOutbox: await outboxManager.getChatOutboxEntries(chatId),
    };
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cacheManager = await getOfflineCacheManager();
      const outboxManager = await getOfflineOutboxManager();
      getOfflineCoordinator().markCacheFallbackUsed();
      return {
        items: await cacheManager.getCachedMessages<MessageViewDto>(chatId),
        offlineOutbox: await outboxManager.getChatOutboxEntries(chatId),
      };
    }
    emitChatError('load-messages', error, { chatId });
    throw error;
  }
}

export async function loadMoreChatMessages(
  chatId: string,
  cursor?: string,
  pageSize = 20,
  service: Pick<DesktopRealmHumanChatService, 'listMessages'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
) {
  if (!cursor) return undefined;
  const resolvedPageSize = normalizeRealmPageSize(pageSize);

  try {
    const result = await service.listMessages(chatId, resolvedPageSize, cursor);
    return result;
  } catch (error) {
    emitChatError('load-more-messages', error, { chatId });
    throw error;
  }
}

function normalizeRealmPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return 20;
  }
  return Math.min(Math.floor(pageSize), 100);
}

export async function sendChatMessage(
  chatId: string,
  content: string,
  options: Partial<SendMessageInputDto>,
  service: Pick<DesktopRealmHumanChatService, 'sendMessage'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
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
    const manager = await getOfflineOutboxManager();
    const entry = toPersistentEntry({
      chatId,
      body: data,
      queuedAt: Date.now(),
      attempts: 0,
    });
    await manager.upsertChatOutboxEntry(entry);

    const message = await service.sendMessage(chatId, data);
    await manager.markChatOutboxSent(data.clientMessageId);
    return message;
  } catch (error) {
    const manager = await getOfflineOutboxManager();
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
    emitChatError('send-message', error, { chatId });
    throw error;
  }
}

export async function flushPendingChatOutbox(
  chatId?: string,
  service: Pick<DesktopRealmHumanChatService, 'sendMessage'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
): Promise<MessageViewDto[]> {
  const manager = await getOfflineOutboxManager();
  const pending = await manager.getChatOutboxEntries(chatId);
  const flushed: MessageViewDto[] = [];
  for (const entry of pending) {
    if (entry.status !== 'pending') {
      continue;
    }
    try {
      const message = await service.sendMessage(entry.chatId, entry.body as SendMessageInputDto);
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
      emitChatError('flush-chat-outbox', error, {
        chatId: entry.chatId,
        clientMessageId: entry.clientMessageId,
      });
    }
  }
  return flushed;
}

export async function markChatAsRead(
  chatId: string,
  service: Pick<DesktopRealmHumanChatService, 'markChatRead'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
) {
  try {
    await service.markChatRead(chatId);
  } catch (error) {
    emitChatError('mark-chat-read', error, { chatId });
  }
}

export async function syncChatEventWindow(
  chatId: string,
  afterSeq: number,
  limit = 200,
  service: Pick<DesktopRealmHumanChatService, 'syncChatEvents'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
): Promise<ChatSyncResultDto> {
  const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  const normalizedLimit = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 200;

  try {
    const result = await service.syncChatEvents(chatId, normalizedAfterSeq, normalizedLimit);
    return result;
  } catch (error) {
    emitChatError('sync-chat-events', error, {
      chatId,
      afterSeq: normalizedAfterSeq,
      limit: normalizedLimit,
    });
    throw error;
  }
}
