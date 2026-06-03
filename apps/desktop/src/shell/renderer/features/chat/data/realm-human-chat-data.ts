import { createNimiClientId } from '@nimiplatform/sdk/runtime';
import {
  countPendingRealmChatOutboxEntries,
  filterRealmDirectHumanChats,
  flushRealmChatOutbox,
  listRealmChatMessages,
  markRealmChatRead,
  normalizeRealmChatLimit,
  realmChatService,
  sendRealmChatTextMessageWithOutbox,
  startRealmChatWithTarget,
  syncRealmChatEvents,
  type RealmChatOutboxStore,
  type RealmChatOutboxStoreEntry,
  type RealmChatSyncResultDto,
  type RealmMessageViewDto,
  type RealmSendMessageInputDto,
  type RealmChatService,
} from '@nimiplatform/kit/features/chat/realm';
import {
  getNimiErrorMessage as getErrorMessage,
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { getOfflineCacheManager } from '@renderer/infra/offline/cache-manager';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';
import { getOfflineOutboxManager } from '@renderer/infra/offline/outbox-manager';
import type { PersistentOutboxEntry } from '@renderer/infra/offline/types';

type DesktopChatErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

type DesktopRealmHumanChatService = RealmChatService;

function emitNoop() {}

function createClientMessageId(): string {
  return createNimiClientId('cm');
}

function toPersistentEntry(entry: RealmChatOutboxStoreEntry): PersistentOutboxEntry {
  return {
    clientMessageId: entry.clientMessageId,
    chatId: entry.chatId,
    body: entry.body as JsonObject,
    enqueuedAt: entry.enqueuedAt,
    attempts: entry.attempts,
    status: entry.status === 'failed' ? 'failed' : 'pending',
    failReason: entry.failReason || undefined,
  };
}

function toKitOutboxEntry(entry: PersistentOutboxEntry): RealmChatOutboxStoreEntry {
  return {
    clientMessageId: entry.clientMessageId,
    chatId: entry.chatId,
    body: entry.body as RealmSendMessageInputDto,
    enqueuedAt: entry.enqueuedAt,
    attempts: entry.attempts,
    status: entry.status,
    failReason: entry.failReason,
  };
}

async function getDesktopRealmChatOutboxStore(): Promise<RealmChatOutboxStore> {
  const manager = await getOfflineOutboxManager();
  return {
    upsertChatOutboxEntry: (entry) => manager.upsertChatOutboxEntry(toPersistentEntry(entry)),
    getChatOutboxEntry: async (clientMessageId) => {
      const entry = await manager.getChatOutboxEntry(clientMessageId);
      return entry ? toKitOutboxEntry(entry) : undefined;
    },
    getChatOutboxEntries: async (chatId) => {
      const entries = await manager.getChatOutboxEntries(chatId);
      return entries.map((entry) => toKitOutboxEntry(entry));
    },
    markChatOutboxSent: (clientMessageId) => manager.markChatOutboxSent(clientMessageId),
    markChatOutboxFailed: (clientMessageId, reason) => manager.markChatOutboxFailed(clientMessageId, reason),
  };
}

function markRealmOffline(error: unknown): void {
  if (isRealmOfflineError(error)) {
    getOfflineCoordinator().markRealmRestReachable(false);
  }
}

export async function countPendingChatOutboxEntries(): Promise<number> {
  return countPendingRealmChatOutboxEntries(await getDesktopRealmChatOutboxStore());
}

export async function loadChatList(
  service: Pick<DesktopRealmHumanChatService, 'listChats'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
  limit = 20,
) {
  try {
    const result = await service.listChats(limit);
    const manager = await getOfflineCacheManager();
    const items = filterRealmDirectHumanChats(result?.items);
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
        items: filterRealmDirectHumanChats(await manager.getCachedChatList()),
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
      items: filterRealmDirectHumanChats(result?.items),
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
    return await startRealmChatWithTarget(targetAccountId, initialMessage, service);
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
        items: await cacheManager.getCachedMessages<RealmMessageViewDto>(chatId),
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

  try {
    const result = await listRealmChatMessages(
      chatId,
      normalizeRealmChatLimit(pageSize, 20, 100),
      cursor,
      service,
    );
    return result;
  } catch (error) {
    emitChatError('load-more-messages', error, { chatId });
    throw error;
  }
}

export async function sendChatMessage(
  chatId: string,
  content: string,
  options: Partial<RealmSendMessageInputDto>,
  service: Pick<DesktopRealmHumanChatService, 'sendMessage'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
) {
  const clientMessageId = String(options.clientMessageId || '').trim() || createClientMessageId();
  try {
    const result = await sendRealmChatTextMessageWithOutbox({
      chatId,
      content,
      options: { ...options, clientMessageId },
      service,
      outbox: await getDesktopRealmChatOutboxStore(),
      createClientMessageId,
      isOfflineError: isRealmOfflineError,
      describeError: (error, fallback) => getErrorMessage(error, fallback),
      failureMessage: '发送消息失败',
      onOffline: markRealmOffline,
    });
    return result.kind === 'sent' ? result.message : result.placeholder;
  } catch (error) {
    emitChatError('send-message', error, { chatId });
    throw error;
  }
}

export async function flushPendingChatOutbox(
  chatId?: string,
  service: Pick<DesktopRealmHumanChatService, 'sendMessage'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
): Promise<RealmMessageViewDto[]> {
  return flushRealmChatOutbox({
    chatId,
    service,
    outbox: await getDesktopRealmChatOutboxStore(),
    isOfflineError: isRealmOfflineError,
    describeError: (error, fallback) => getErrorMessage(error, fallback),
    failureMessage: '重放聊天消息失败',
    stopOnOffline: false,
    onOffline: markRealmOffline,
    onEntryError: (error, entry) => {
      emitChatError('flush-chat-outbox', error, {
        chatId: entry.chatId,
        clientMessageId: entry.clientMessageId,
      });
    },
  });
}

export async function markChatAsRead(
  chatId: string,
  service: Pick<DesktopRealmHumanChatService, 'markChatRead'> = realmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
) {
  try {
    await markRealmChatRead(chatId, service);
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
): Promise<RealmChatSyncResultDto> {
  try {
    const result = await syncRealmChatEvents(chatId, afterSeq, limit, service);
    return result;
  } catch (error) {
    emitChatError('sync-chat-events', error, {
      chatId,
      afterSeq,
      limit,
    });
    throw error;
  }
}
