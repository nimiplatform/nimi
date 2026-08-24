import { createNimiClientId } from '@nimiplatform/sdk';
import {
  buildRealmTextMessageInput,
  createRealmChatService,
  filterRealmDirectHumanChats,
  listRealmChatMessages,
  markRealmChatRead,
  normalizeRealmChatLimit,
  startRealmChatWithTarget,
  type RealmMessageViewDto,
  type RealmSendMessageInputDto,
  type RealmChatService,
} from '@nimiplatform/kit/features/chat/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
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

function requireOffline(
  offline: DesktopRendererOfflinePort | undefined,
): DesktopRendererOfflinePort {
  if (!offline) throw new Error('DESKTOP_REALM_CHAT_OFFLINE_PORT_REQUIRED');
  return offline;
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
  const clientMessageId = String(options.clientMessageId || '').trim() || createClientMessageId();
  try {
    return await service.sendMessage(
      chatId,
      buildRealmTextMessageInput(content, {
        ...options,
        clientMessageId,
      }),
    );
  } catch (error) {
    if (offline && isRealmOfflineError(error)) {
      offline.markRealmUnreachable();
    }
    emitChatError('send-message', error, { chatId });
    throw error;
  }
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
    markChatAsRead: (chatId: string) => markChatAsRead(chatId, service, emit),
  });
}

export type RealmHumanChatData = ReturnType<typeof createRealmHumanChatData>;
