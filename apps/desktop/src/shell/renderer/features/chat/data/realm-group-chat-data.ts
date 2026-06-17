import {
  addNimiRealmGroupParticipant,
  createNimiRealmGroupChat,
  createNimiRealmGroupTextMessageInput,
  listNimiRealmGroupChats,
  loadNimiRealmGroupChat,
  loadNimiRealmGroupMessages,
  markNimiRealmGroupRead,
  removeNimiRealmGroupParticipant,
  sendNimiRealmGroupMessage,
  syncNimiRealmGroupEvents,
  type Realm,
} from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  buildRuntimeLocalAgentRef,
  createNimiHostRuntimeRealmGroupMessageCandidateSurface,
} from '@nimiplatform/sdk/runtime';
import { createNimiClientId, type JsonObject } from '@nimiplatform/sdk/types';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
type ListGroupChatsResultDto = RealmModel<'ListGroupChatsResultDto'>;
type ListGroupMessagesResultDto = RealmModel<'ListGroupMessagesResultDto'>;
type RealmGroupMessageCandidateCommitResultDto = never;

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

function requireSourceParticipant(participant: GroupParticipantDto): {
  runtimeParticipantSlot: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  ownerUserId: string;
} {
  const runtimeParticipantSlot = normalizeText(participant.runtimeParticipantSlot);
  const runtimeSourceRef = normalizeText(participant.runtimeSourceRef);
  const ownerUserId = normalizeText(participant.sourceOwnerId);
  if (participant.type !== 'source' || !runtimeParticipantSlot || !runtimeSourceRef || !ownerUserId) {
    throw new Error('group source candidate handoff requires a runtime source participant with local agent materialization');
  }
  const localAgentRef = buildRuntimeLocalAgentRef({
    ownerUserId,
    runtimeSourceRef,
  });
  return { runtimeParticipantSlot, runtimeSourceRef, localAgentRef, ownerUserId };
}

export async function loadGroupChatList(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  limit = 20,
): Promise<ListGroupChatsResultDto> {
  try {
    const result = await callApi(
      (realm) => listNimiRealmGroupChats(realm, limit),
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
      (realm) => loadNimiRealmGroupChat(realm, chatId),
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
      (realm) => loadNimiRealmGroupMessages(realm, chatId, limit),
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
      (realm) => sendNimiRealmGroupMessage(
        realm,
        chatId,
        createNimiRealmGroupTextMessageInput(content, clientMessageId),
      ),
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
  const sourceParticipant = requireSourceParticipant(participant);
  const triggerMessageId = normalizeText(triggerMessage.id);
  const idempotencyKey = createStableClientId('rgmc');
  const surface = createNimiHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => {
      const accountRuntime = getDesktopAccountRuntime();
      return {
        appId: getDesktopAppId(),
        auth: accountRuntime.auth,
        appAuth: accountRuntime.grants,
        agent: getDesktopRuntime().agents,
      };
    },
    getSubjectUserId: () => currentUserId,
  });

  try {
    const candidateCommit = await surface.createCommitPayload({
      participantType: participant.type,
      currentUserId,
      realmGroupThreadId: chatId,
      runtimeParticipantSlot: sourceParticipant.runtimeParticipantSlot,
      ownerUserId: sourceParticipant.ownerUserId,
      runtimeSourceRef: sourceParticipant.runtimeSourceRef,
      localAgentRef: sourceParticipant.localAgentRef,
      triggerMessageId,
      idempotencyKey,
    });
    void candidateCommit;
    throw new Error('Realm group source message candidate commit is not implemented in current Realm SDK surface');
  } catch (error) {
    emitRealmGroupChatError('commit-realm-group-message-candidate', error, {
      chatId,
      runtimeParticipantSlot: normalizeText(participant.runtimeParticipantSlot),
      localAgentRef: sourceParticipant.localAgentRef,
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

export async function addGroupChatSource(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
  sourceAccountId: string,
) {
  try {
    const result = await callApi(
      (realm) => addNimiRealmGroupParticipant(realm, chatId, sourceAccountId),
      '添加群组 Source 失败',
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('add-group-source', error, { chatId, sourceAccountId });
    throw error;
  }
}

export async function removeGroupChatSource(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
  sourceAccountId: string,
) {
  try {
    await callApi(
      (realm) => removeNimiRealmGroupParticipant(realm, chatId, sourceAccountId),
      '移除群组 Source 失败',
    );
  } catch (error) {
    emitRealmGroupChatError('remove-group-source', error, { chatId, sourceAccountId });
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
  addGroupSource: (chatId: string, sourceAccountId: string) =>
    addGroupChatSource(callRealmApi, emitRealmDataError, chatId, sourceAccountId),
  removeGroupSource: (chatId: string, sourceAccountId: string) =>
    removeGroupChatSource(callRealmApi, emitRealmDataError, chatId, sourceAccountId),
};
