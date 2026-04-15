import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@runtime/net/json';

type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type ListGroupChatsResultDto = RealmModel<'ListGroupChatsResultDto'>;
type ListGroupMessagesResultDto = RealmModel<'ListGroupMessagesResultDto'>;
type MessageType = RealmModel<'MessageType'>;

export type { GroupChatViewDto, GroupMessageViewDto };

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export async function loadGroupChatList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  limit = 20,
): Promise<ListGroupChatsResultDto> {
  try {
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.listGroups(limit),
      '加载群组列表失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-group-chats', error);
    throw error;
  }
}

export async function loadGroupChat(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
): Promise<GroupChatViewDto> {
  try {
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.getGroup(chatId),
      '加载群组详情失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-group-chat', error, { chatId });
    throw error;
  }
}

export async function loadGroupChatMessages(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  limit: number,
): Promise<ListGroupMessagesResultDto> {
  try {
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.listGroupMessages(chatId, limit),
      '加载群组消息失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('load-group-messages', error, { chatId });
    throw error;
  }
}

export async function sendGroupChatMessage(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  content: string,
) {
  try {
    const clientMessageId = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const message = await callApi(
      (realm) => realm.services.GroupChatsService.sendGroupMessage(chatId, {
        clientMessageId,
        type: 'TEXT' as MessageType,
        text: content,
        payload: { content },
      }),
      '发送群组消息失败',
    );
    return message;
  } catch (error) {
    emitDataSyncError('send-group-message', error, { chatId });
    throw error;
  }
}

export async function markGroupChatRead(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
) {
  try {
    await callApi(
      (realm) => realm.services.GroupChatsService.markGroupRead(chatId),
    );
  } catch (error) {
    emitDataSyncError('mark-group-read', error, { chatId });
  }
}

export async function createGroupChat(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  title: string,
  participantIds: string[],
  initialMessage?: string,
) {
  try {
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.createGroup({
        title,
        participantIds,
        text: initialMessage || undefined,
      }),
      '创建群组失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('create-group', error, {
      title,
      participantCount: participantIds.length,
    });
    throw error;
  }
}

export async function sendGroupAgentChatMessage(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  agentAccountId: string,
  text: string,
  replyToMessageId?: string,
) {
  try {
    const clientMessageId = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const message = await callApi(
      (realm) => realm.services.GroupChatsService.sendGroupAgentMessage(chatId, {
        agentAccountId,
        clientMessageId,
        type: 'TEXT' as MessageType,
        text,
        payload: { content: text },
        replyToMessageId: replyToMessageId || undefined,
      }),
      '发送群组 Agent 消息失败',
    );
    return message;
  } catch (error) {
    emitDataSyncError('send-group-agent-message', error, { chatId, agentAccountId });
    throw error;
  }
}

export async function addGroupChatAgent(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  agentAccountId: string,
) {
  try {
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.addGroupAgent(chatId, { agentAccountId }),
      '添加群组 Agent 失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('add-group-agent', error, { chatId, agentAccountId });
    throw error;
  }
}

export async function removeGroupChatAgent(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  agentAccountId: string,
) {
  try {
    await callApi(
      (realm) => realm.services.GroupChatsService.removeGroupAgent(chatId, agentAccountId),
      '移除群组 Agent 失败',
    );
  } catch (error) {
    emitDataSyncError('remove-group-agent', error, { chatId, agentAccountId });
    throw error;
  }
}

export async function syncGroupChatEvents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  chatId: string,
  afterSeq: number,
  limit = 200,
) {
  const normalizedAfterSeq = Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0;
  const normalizedLimit = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 200;
  try {
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.syncGroupEvents(chatId, normalizedLimit, normalizedAfterSeq),
      '同步群组事件失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('sync-group-events', error, { chatId, afterSeq: normalizedAfterSeq });
    throw error;
  }
}
