import { createNimiClientId } from '@nimiplatform/sdk';
import {
  countPendingRealmChatOutboxEntries,
  createRealmChatService,
  filterRealmDirectHumanChats,
  flushRealmChatOutbox,
  listRealmChatMessages,
  markRealmChatRead,
  normalizeRealmChatLimit,
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
  isJsonObject,
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import type { PersistentOutboxEntry } from '../../../infra/offline/types';
import type { DesktopRendererOfflinePort } from '../../../renderer/offline-port.js';
import type { DesktopRendererSdkPort } from '../../../renderer/sdk-port.js';

type DesktopChatErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

type DesktopRealmHumanChatService = RealmChatService;

export function createDesktopRealmChatService(
  callApi: DesktopRendererSdkPort['socialData']['callApi'],
): RealmChatService {
  function callService<T>(task: (service: RealmChatService) => Promise<T>): Promise<T> {
    return callApi((realm) => task(createRealmChatService(realm.humanChats)));
  }
  return Object.freeze({
    listChats: (limit, cursor) => callService((service) => service.listChats(limit, cursor)),
    getChatById: (chatId) => callService((service) => service.getChatById(chatId)),
    startChat: (input) => callService((service) => service.startChat(input)),
    listMessages: (chatId, limit, cursor) => callService((service) => service.listMessages(chatId, limit, cursor)),
    sendMessage: (chatId, input) => callService((service) => service.sendMessage(chatId, input)),
    markChatRead: (chatId) => callService((service) => service.markChatRead(chatId)),
    syncChatEvents: (chatId, afterSeq, limit) => callService((service) => service.syncChatEvents(chatId, afterSeq, limit)),
  });
}

const missingRealmChatService = async (): Promise<never> => {
  throw new Error('DESKTOP_REALM_CHAT_SERVICE_REQUIRED');
};
const unavailableRealmChatService: RealmChatService = Object.freeze({
  listChats: missingRealmChatService,
  getChatById: missingRealmChatService,
  startChat: missingRealmChatService,
  listMessages: missingRealmChatService,
  sendMessage: missingRealmChatService,
  markChatRead: missingRealmChatService,
  syncChatEvents: missingRealmChatService,
});

function emitNoop() {}

function createClientMessageId(): string {
  return createNimiClientId('cm');
}

function parseRequiredPersistentString(
  body: JsonObject,
  field: 'clientMessageId' | 'type',
): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Persistent chat outbox body.${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseOptionalPersistentString(
  body: JsonObject,
  field: 'replyToMessageId' | 'text',
): string | undefined {
  const value = body[field];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Persistent chat outbox body.${field} must be a string`);
  }
  return value;
}

function parsePersistentMessageType(value: string): RealmSendMessageInputDto['type'] {
  switch (value) {
    case 'TEXT':
    case 'ATTACHMENT':
    case 'POST_REF':
    case 'USER_REF':
    case 'LINK_REF':
    case 'GIFT':
    case 'FRIEND_REQUEST':
    case 'SYSTEM':
    case 'RECALL':
      return value;
    default:
      throw new Error(`Persistent chat outbox body.type is unsupported: ${value}`);
  }
}

function serializeRealmSendMessageInput(body: RealmSendMessageInputDto): JsonObject {
  const serialized: JsonObject = {
    clientMessageId: body.clientMessageId,
    type: body.type,
  };
  if (typeof body.text === 'string') {
    serialized.text = body.text;
  }
  if (typeof body.replyToMessageId === 'string') {
    serialized.replyToMessageId = body.replyToMessageId;
  }
  if (isJsonObject(body.payload)) {
    serialized.payload = body.payload;
  }
  return serialized;
}

function parsePersistentRealmSendMessageInput(body: JsonObject): RealmSendMessageInputDto {
  const input: {
    clientMessageId: string;
    payload?: RealmSendMessageInputDto['payload'];
    replyToMessageId?: string;
    text?: string;
    type: RealmSendMessageInputDto['type'];
  } = {
    clientMessageId: parseRequiredPersistentString(body, 'clientMessageId'),
    type: parsePersistentMessageType(parseRequiredPersistentString(body, 'type')),
  };

  const text = parseOptionalPersistentString(body, 'text');
  if (text !== undefined) {
    input.text = text;
  }
  const replyToMessageId = parseOptionalPersistentString(body, 'replyToMessageId');
  if (replyToMessageId !== undefined) {
    input.replyToMessageId = replyToMessageId;
  }
  const payload = body.payload;
  if (payload !== null && payload !== undefined) {
    if (!isJsonObject(payload)) {
      throw new Error('Persistent chat outbox body.payload must be an object');
    }
    input.payload = payload;
  }
  return input;
}

function toPersistentEntry(entry: RealmChatOutboxStoreEntry): PersistentOutboxEntry {
  return {
    clientMessageId: entry.clientMessageId,
    chatId: entry.chatId,
    body: serializeRealmSendMessageInput(entry.body),
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
    body: parsePersistentRealmSendMessageInput(entry.body),
    enqueuedAt: entry.enqueuedAt,
    attempts: entry.attempts,
    status: entry.status,
    failReason: entry.failReason,
  };
}

function requireOffline(
  offline: DesktopRendererOfflinePort | undefined,
): DesktopRendererOfflinePort {
  if (!offline) throw new Error('DESKTOP_REALM_CHAT_OFFLINE_PORT_REQUIRED');
  return offline;
}

async function getDesktopRealmChatOutboxStore(
  offline: DesktopRendererOfflinePort,
): Promise<RealmChatOutboxStore> {
  return {
    upsertChatOutboxEntry: (entry) => offline.upsertChatOutboxEntry(toPersistentEntry(entry)),
    getChatOutboxEntry: async (clientMessageId) => {
      const entry = await offline.getChatOutboxEntry(clientMessageId);
      return entry ? toKitOutboxEntry(entry) : undefined;
    },
    getChatOutboxEntries: async (chatId) => {
      const entries = await offline.getChatOutboxEntries(chatId);
      return entries.map((entry) => toKitOutboxEntry(entry));
    },
    markChatOutboxSent: (clientMessageId) => offline.markChatOutboxSent(clientMessageId),
    markChatOutboxFailed: (clientMessageId, reason) => offline.markChatOutboxFailed(clientMessageId, reason),
  };
}

function markRealmOffline(error: unknown, offline: DesktopRendererOfflinePort): void {
  if (isRealmOfflineError(error)) {
    offline.markRealmUnreachable();
  }
}

export async function countPendingChatOutboxEntries(
  offline: DesktopRendererOfflinePort,
): Promise<number> {
  return countPendingRealmChatOutboxEntries(await getDesktopRealmChatOutboxStore(offline));
}

export async function loadChatList(
  service: Pick<DesktopRealmHumanChatService, 'listChats'> = unavailableRealmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
  limit = 20,
  offline?: DesktopRendererOfflinePort,
) {
  try {
    const result = await service.listChats(limit);
    const cache = requireOffline(offline);
    const items = filterRealmDirectHumanChats(result?.items);
    await cache.syncChatList(items);
    return {
      ...result,
      items,
    };
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cache = requireOffline(offline);
      cache.markCacheFallbackUsed();
      return {
        items: filterRealmDirectHumanChats(await cache.getCachedChatList()),
      };
    }
    emitChatError('load-chats', error);
    throw error;
  }
}

export async function loadMoreChatList(
  service: Pick<DesktopRealmHumanChatService, 'listChats'> = unavailableRealmChatService,
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
  service: Pick<DesktopRealmHumanChatService, 'startChat' | 'getChatById'> = unavailableRealmChatService,
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
  service: Pick<DesktopRealmHumanChatService, 'listMessages'> = unavailableRealmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
  offline?: DesktopRendererOfflinePort,
) {
  const offlinePort = requireOffline(offline);
  try {
    const result = await service.listMessages(chatId, limit);
    const items = Array.isArray(result?.items) ? result.items : [];
    await offlinePort.syncChatMessages(chatId, items);
    if (markChatRead) {
      await markChatRead(chatId);
    }
    return {
      ...result,
      offlineOutbox: await offlinePort.getChatOutboxEntries(chatId),
    };
  } catch (error) {
    if (isRealmOfflineError(error)) {
      offlinePort.markCacheFallbackUsed();
      return {
        items: await offlinePort.getCachedMessages<RealmMessageViewDto>(chatId),
        offlineOutbox: await offlinePort.getChatOutboxEntries(chatId),
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
  service: Pick<DesktopRealmHumanChatService, 'listMessages'> = unavailableRealmChatService,
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
  service: Pick<DesktopRealmHumanChatService, 'sendMessage'> = unavailableRealmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
  offline?: DesktopRendererOfflinePort,
) {
  const offlinePort = requireOffline(offline);
  const clientMessageId = String(options.clientMessageId || '').trim() || createClientMessageId();
  try {
    const result = await sendRealmChatTextMessageWithOutbox({
      chatId,
      content,
      options: { ...options, clientMessageId },
      service,
      outbox: await getDesktopRealmChatOutboxStore(offlinePort),
      createClientMessageId,
      isOfflineError: isRealmOfflineError,
      describeError: (error, fallback) => getErrorMessage(error, fallback),
      failureMessage: '发送消息失败',
      onOffline: (error) => markRealmOffline(error, offlinePort),
    });
    return result.kind === 'sent' ? result.message : result.placeholder;
  } catch (error) {
    emitChatError('send-message', error, { chatId });
    throw error;
  }
}

export async function flushPendingChatOutbox(
  chatId?: string,
  service: Pick<DesktopRealmHumanChatService, 'sendMessage'> = unavailableRealmChatService,
  emitChatError: DesktopChatErrorEmitter = emitNoop,
  offline?: DesktopRendererOfflinePort,
): Promise<RealmMessageViewDto[]> {
  const offlinePort = requireOffline(offline);
  return flushRealmChatOutbox({
    chatId,
    service,
    outbox: await getDesktopRealmChatOutboxStore(offlinePort),
    isOfflineError: isRealmOfflineError,
    describeError: (error, fallback) => getErrorMessage(error, fallback),
    failureMessage: '重放聊天消息失败',
    stopOnOffline: false,
    onOffline: (error) => markRealmOffline(error, offlinePort),
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
  service: Pick<DesktopRealmHumanChatService, 'markChatRead'> = unavailableRealmChatService,
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
  service: Pick<DesktopRealmHumanChatService, 'syncChatEvents'> = unavailableRealmChatService,
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

export function createRealmHumanChatData(sdk: DesktopRendererSdkPort) {
  const service = createDesktopRealmChatService(sdk.socialData.callApi);
  const emit = sdk.socialData.emitDataError;
  return Object.freeze({
    loadChatList: (limit = 20) => loadChatList(service, emit, limit, sdk.offline),
    loadMoreChatList: (cursor?: string) => loadMoreChatList(service, emit, cursor),
    startChatWithTarget: (targetAccountId: string, initialMessage: string | null = null) =>
      startChatWithTarget(targetAccountId, initialMessage, service, emit),
    loadChatMessages: (chatId: string, limit: number, markRead?: (chatId: string) => Promise<void>) =>
      loadChatMessages(chatId, limit, markRead, service, emit, sdk.offline),
    loadMoreChatMessages: (chatId: string, cursor?: string, pageSize = 20) =>
      loadMoreChatMessages(chatId, cursor, pageSize, service, emit),
    sendChatMessage: (chatId: string, content: string, options: Partial<RealmSendMessageInputDto>) =>
      sendChatMessage(chatId, content, options, service, emit, sdk.offline),
    flushPendingChatOutbox: (chatId?: string) => flushPendingChatOutbox(chatId, service, emit, sdk.offline),
    markChatAsRead: (chatId: string) => markChatAsRead(chatId, service, emit),
    syncChatEventWindow: (chatId: string, afterSeq: number, limit = 200) =>
      syncChatEventWindow(chatId, afterSeq, limit, service, emit),
  });
}

export type RealmHumanChatData = ReturnType<typeof createRealmHumanChatData>;
