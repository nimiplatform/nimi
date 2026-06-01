import { getPlatformClient } from '@nimiplatform/sdk';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  createNimiClientId,
  createHostRuntimeRealmGroupMessageCandidateSurface,
} from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@nimiplatform/sdk/types';

type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
type ListGroupChatsResultDto = RealmModel<'ListGroupChatsResultDto'>;
type ListGroupMessagesResultDto = RealmModel<'ListGroupMessagesResultDto'>;
type RealmGroupMessageCandidateCommitResultDto = RealmModel<'RealmGroupMessageCandidateCommitResultDto'>;
type MessageType = RealmModel<'MessageType'>;

export type { GroupChatViewDto, GroupMessageViewDto };

type RealmGroupChatApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmGroupChatErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;
type CurrentUserReader = () => Record<string, unknown> | null;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createStableClientId(prefix: string): string {
  return createNimiClientId(prefix);
}

function requireCurrentUserId(getCurrentUser: CurrentUserReader): string {
  const id = normalizeText(getCurrentUser()?.id);
  if (!id) {
    throw new Error('group agent candidate handoff requires authenticated current user id');
  }
  return id;
}

export async function loadGroupChatList(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  limit = 20,
): Promise<ListGroupChatsResultDto> {
  try {
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.listGroups(limit),
      '加载群组列表失败',
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
      (realm) => realm.services.GroupChatsService.getGroup(chatId),
      '加载群组详情失败',
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
      (realm) => realm.services.GroupChatsService.listGroupMessages(chatId, limit),
      '加载群组消息失败',
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
    emitRealmGroupChatError('send-group-message', error, { chatId });
    throw error;
  }
}

export async function commitRealmGroupMessageCandidateHandoff(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  getCurrentUser: CurrentUserReader,
  chatId: string,
  participant: GroupParticipantDto,
  triggerMessage: GroupMessageViewDto,
): Promise<RealmGroupMessageCandidateCommitResultDto> {
  const currentUserId = requireCurrentUserId(getCurrentUser);
  const runtime = getPlatformClient().runtime;
  const triggerMessageId = normalizeText(triggerMessage.id);
  const idempotencyKey = createStableClientId('rgmc');
  const surface = createHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => currentUserId,
  });

  try {
    const candidateCommit = await surface.createCommitPayload({
      participantType: participant.type,
      currentUserId,
      realmGroupThreadId: chatId,
      realmGroupAgentSlotId: participant.realmGroupAgentSlotId,
      ownerUserId: participant.agentOwnerId,
      realmAgentId: participant.realmAgentId,
      localAgentRef: participant.localAgentRef,
      triggerMessageId,
      idempotencyKey,
    });
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.commitRealmGroupMessageCandidate(
        chatId,
        candidateCommit.realmCommitPayload,
      ),
      '提交群组 Agent 候选消息失败',
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('commit-realm-group-message-candidate', error, {
      chatId,
      realmGroupAgentSlotId: normalizeText(participant.realmGroupAgentSlotId),
      localAgentRef: normalizeText(participant.localAgentRef),
    });
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
      (realm) => realm.services.GroupChatsService.markGroupRead(chatId),
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
      (realm) => realm.services.GroupChatsService.createGroup({
        title,
        participantIds,
        text: initialMessage || undefined,
      }),
      '创建群组失败',
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

export async function addGroupChatAgent(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
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
    emitRealmGroupChatError('add-group-agent', error, { chatId, agentAccountId });
    throw error;
  }
}

export async function removeGroupChatAgent(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
  agentAccountId: string,
) {
  try {
    await callApi(
      (realm) => realm.services.GroupChatsService.removeGroupAgent(chatId, agentAccountId),
      '移除群组 Agent 失败',
    );
  } catch (error) {
    emitRealmGroupChatError('remove-group-agent', error, { chatId, agentAccountId });
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
      (realm) => realm.services.GroupChatsService.syncGroupEvents(chatId, normalizedLimit, normalizedAfterSeq),
      '同步群组事件失败',
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('sync-group-events', error, { chatId, afterSeq: normalizedAfterSeq });
    throw error;
  }
}

function getCurrentUser(): Record<string, unknown> | null {
  return useAppStore.getState().auth.user;
}

export const realmGroupChatData = {
  loadGroupChats: (limit = 20) =>
    loadGroupChatList(callRealmApi, emitRealmDataError, Math.min(limit, 100)),
  loadGroupChat: (chatId: string) =>
    loadGroupChat(callRealmApi, emitRealmDataError, chatId),
  loadGroupMessages: (chatId: string, limit = 50) =>
    loadGroupChatMessages(callRealmApi, emitRealmDataError, chatId, Math.min(limit, 100)),
  sendGroupMessage: (chatId: string, content: string) =>
    sendGroupChatMessage(callRealmApi, emitRealmDataError, chatId, content),
  commitRealmGroupMessageCandidate: (
    chatId: string,
    participant: GroupParticipantDto,
    triggerMessage: GroupMessageViewDto,
  ) =>
    commitRealmGroupMessageCandidateHandoff(
      callRealmApi,
      emitRealmDataError,
      getCurrentUser,
      chatId,
      participant,
      triggerMessage,
    ),
  markGroupRead: (chatId: string) =>
    markGroupChatRead(callRealmApi, emitRealmDataError, chatId),
  createGroup: (title: string, participantIds: string[], initialMessage?: string) =>
    createGroupChat(callRealmApi, emitRealmDataError, title, participantIds, initialMessage),
  syncGroupEvents: (chatId: string, afterSeq: number, limit = 100) =>
    syncGroupChatEvents(callRealmApi, emitRealmDataError, chatId, afterSeq, Math.min(limit, 100)),
  addGroupAgent: (chatId: string, agentAccountId: string) =>
    addGroupChatAgent(callRealmApi, emitRealmDataError, chatId, agentAccountId),
  removeGroupAgent: (chatId: string, agentAccountId: string) =>
    removeGroupChatAgent(callRealmApi, emitRealmDataError, chatId, agentAccountId),
};
