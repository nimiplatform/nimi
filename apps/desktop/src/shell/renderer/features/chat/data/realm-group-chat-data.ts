import {
  createNimiRealmGroupChat,
  createNimiRealmGroupTextMessageInput,
  listNimiRealmGroupChats,
  loadNimiRealmGroupChat,
  loadNimiRealmGroupMessages,
  markNimiRealmGroupRead,
  sendNimiRealmGroupMessage,
  syncNimiRealmGroupEvents,
  type Realm,
} from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import type { DesktopRendererSdkPort } from '../../../renderer/sdk-port.js';
import { createNimiClientId, type JsonObject } from '@nimiplatform/sdk/types';
import { i18n } from '../../../i18n/index.js';

type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
type ListGroupChatsResultDto = RealmModel<'ListGroupChatsResultDto'>;
type ListGroupMessagesResultDto = RealmModel<'ListGroupMessagesResultDto'>;

export type { GroupChatViewDto };

type RealmGroupChatApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmGroupChatErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;
function createStableClientId(prefix: string): string {
  return createNimiClientId(prefix);
}

function groupChatFallbackMessage(key: string, defaultValue: string): string {
  const translated = i18n.t(key, { defaultValue });
  return typeof translated === 'string' && translated.trim().length > 0
    ? translated
    : defaultValue;
}

export async function loadGroupChatList(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  limit = 20,
): Promise<ListGroupChatsResultDto> {
  try {
    const result = await callApi(
      (realm) => listNimiRealmGroupChats(realm, limit),
      groupChatFallbackMessage('Chat.groupLoadListFailed', 'Failed to load groups'),
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('load-group-chats', error);
    throw error;
  }
}

export async function loadGroupChat(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
): Promise<GroupChatViewDto> {
  try {
    const result = await callApi(
      (realm) => loadNimiRealmGroupChat(realm, chatId),
      groupChatFallbackMessage('Chat.groupLoadDetailFailed', 'Failed to load group details'),
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('load-group-chat', error, { chatId });
    throw error;
  }
}

export async function loadGroupChatMessages(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
  limit: number,
): Promise<ListGroupMessagesResultDto> {
  try {
    const result = await callApi(
      (realm) => loadNimiRealmGroupMessages(realm, chatId, limit),
      groupChatFallbackMessage('Chat.groupLoadMessagesFailed', 'Failed to load group messages'),
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('load-group-messages', error, { chatId });
    throw error;
  }
}

export async function sendGroupChatMessage(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
  content: string,
) {
  try {
    const clientMessageId = createStableClientId('cm');
    const message = await callApi(
      (realm) => sendNimiRealmGroupMessage(
        realm,
        chatId,
        createNimiRealmGroupTextMessageInput(content, clientMessageId),
      ),
      groupChatFallbackMessage('Chat.groupSendMessageFailed', 'Failed to send group message'),
    );
    return message;
  } catch (error) {
    emitRealmGroupChatError('send-group-message', error, { chatId });
    throw error;
  }
}

export async function markGroupChatRead(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
) {
  try {
    await callApi(
      (realm) => markNimiRealmGroupRead(realm, chatId),
    );
  } catch (error) {
    emitRealmGroupChatError('mark-group-read', error, { chatId });
  }
}

export async function createGroupChat(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  title: string,
  participantIds: string[],
  initialMessage?: string,
) {
  try {
    const result = await callApi(
      (realm) => createNimiRealmGroupChat(realm, {
        title,
        participantIds,
        text: initialMessage || undefined,
      }),
      groupChatFallbackMessage('Chat.createGroupError', 'Failed to create group'),
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('create-group', error, {
      title,
      participantCount: participantIds.length,
    });
    throw error;
  }
}

export async function syncGroupChatEvents(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
  afterSeq: number,
  limit = 200,
) {
  const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  const normalizedLimit = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 200;
  try {
    const result = await callApi(
      (realm) => syncNimiRealmGroupEvents(realm, chatId, normalizedAfterSeq, normalizedLimit),
      groupChatFallbackMessage('Chat.groupSyncEventsFailed', 'Failed to sync group events'),
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('sync-group-events', error, { chatId, afterSeq: normalizedAfterSeq });
    throw error;
  }
}

export function createRealmGroupChatData(input: {
  sdk: DesktopRendererSdkPort;
}) {
  const callApi = input.sdk.socialData.callApi;
  const emitRealmDataError = input.sdk.socialData.emitDataError;
  return Object.freeze({
  loadGroupChats: (limit = 20) =>
    loadGroupChatList(callApi, emitRealmDataError, Math.min(limit, 100)),
  loadGroupChat: (chatId: string) =>
    loadGroupChat(callApi, emitRealmDataError, chatId),
  loadGroupMessages: (chatId: string, limit = 50) =>
    loadGroupChatMessages(callApi, emitRealmDataError, chatId, Math.min(limit, 100)),
  sendGroupMessage: (chatId: string, content: string) =>
    sendGroupChatMessage(callApi, emitRealmDataError, chatId, content),
  markGroupRead: (chatId: string) =>
    markGroupChatRead(callApi, emitRealmDataError, chatId),
  createGroup: (title: string, participantIds: string[], initialMessage?: string) =>
    createGroupChat(callApi, emitRealmDataError, title, participantIds, initialMessage),
  syncGroupEvents: (chatId: string, afterSeq: number, limit = 100) =>
    syncGroupChatEvents(callApi, emitRealmDataError, chatId, afterSeq, Math.min(limit, 100)),
  });
}

export type RealmGroupChatData = ReturnType<typeof createRealmGroupChatData>;
