import {
  addNimiRealmGroupSourceParticipant,
  commitNimiRealmGroupSourceMessageCandidate,
  createNimiRealmGroupChat,
  createNimiRealmGroupTextMessageInput,
  listNimiRealmGroupChats,
  loadNimiRealmGroupChat,
  loadNimiRealmGroupMessages,
  markNimiRealmGroupRead,
  removeNimiRealmGroupSourceParticipant,
  sendNimiRealmGroupMessage,
  syncNimiRealmGroupEvents,
  type Realm,
  type NimiRealmGroupSourceParticipantInput,
} from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  createNimiHostRuntimeRealmGroupMessageCandidateSurface,
  isRuntimeLocalAgentRef,
} from '@nimiplatform/sdk/runtime';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { createNimiClientId, type JsonObject } from '@nimiplatform/sdk/types';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import { assertGroupTriggerMessageMatchesChat } from './realm-group-trigger-evidence';

type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
type ListGroupChatsResultDto = RealmModel<'ListGroupChatsResultDto'>;
type ListGroupMessagesResultDto = RealmModel<'ListGroupMessagesResultDto'>;
type RealmGroupMessageCandidateCommitResultDto = RealmModel<'RealmGroupMessageCandidateCommitResultDto'>;

export type { GroupChatViewDto, GroupMessageViewDto };
export type GroupSourceParticipantInput = NimiRealmGroupSourceParticipantInput;

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
    throw new Error('group source candidate handoff requires authenticated current user id');
  }
  return id;
}

function requireSourceParticipant(participant: GroupParticipantDto): {
  runtimeParticipantSlot: string;
  runtimeSourceRef: string;
  ownerUserId: string;
} {
  const runtimeParticipantSlot = normalizeText(participant.runtimeParticipantSlot);
  const runtimeSourceRef = normalizeText(participant.runtimeSourceRef);
  const ownerUserId = normalizeText(participant.sourceOwnerId);
  if (
    participant.type !== 'source'
    || !runtimeParticipantSlot
    || !runtimeSourceRef
    || !ownerUserId
  ) {
    throw new Error('group source candidate handoff requires a runtime source participant');
  }
  return { runtimeParticipantSlot, runtimeSourceRef, ownerUserId };
}

async function resolveGroupSourceLocalAgentRef(input: {
  ownerUserId: string;
  runtimeSourceRef: string;
}): Promise<string> {
  const runtime = getDesktopRuntime();
  const response = await withDesktopRuntimeProtectedScopes(
    ['runtime.agent.read'],
    (callOptions) => runtime.agents.listAgents({
      lifecycleFilter: AgentLifecycleStatus.ACTIVE,
      pageSize: 200,
      pageToken: '',
    }, callOptions),
  );
  const matchingLocalAgents = (response.agents || []).filter((agent) => (
    normalizeText(agent.ownerUserId) === input.ownerUserId
    && normalizeText(agent.runtimeSourceRef) === input.runtimeSourceRef
    && isRuntimeLocalAgentRef(agent.localAgentRef)
  ));
  if (matchingLocalAgents.length !== 1) {
    throw new Error('group source candidate handoff requires exactly one matching Runtime local agent for source provenance');
  }
  const localAgentRef = normalizeText(matchingLocalAgents[0]?.localAgentRef);
  if (!isRuntimeLocalAgentRef(localAgentRef)) {
    throw new Error('group source candidate handoff resolved malformed Runtime local agent identity');
  }
  return localAgentRef;
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

export async function commitRealmGroupSourceMessageCandidateHandoff(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  getCurrentUser: CurrentUserReader,
  chatId: string,
  participant: GroupParticipantDto,
  triggerMessage: GroupMessageViewDto,
): Promise<RealmGroupMessageCandidateCommitResultDto> {
  const currentUserId = requireCurrentUserId(getCurrentUser);
  const sourceParticipant = requireSourceParticipant(participant);
  const localAgentRef = await resolveGroupSourceLocalAgentRef({
    ownerUserId: sourceParticipant.ownerUserId,
    runtimeSourceRef: sourceParticipant.runtimeSourceRef,
  });
  const triggerMessageId = assertGroupTriggerMessageMatchesChat({
    chatId,
    currentUserId,
    triggerMessage,
  });
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
      localAgentRef,
      triggerMessageId,
      triggerKind: 'mention',
      idempotencyKey,
    });
    return await callApi(
      (realm) => commitNimiRealmGroupSourceMessageCandidate(
        realm,
        chatId,
        candidateCommit.realmCommitPayload,
      ),
      '提交群组 Source 消息失败',
    );
  } catch (error) {
    emitRealmGroupChatError('commit-realm-group-message-candidate', error, {
      chatId,
      runtimeParticipantSlot: normalizeText(participant.runtimeParticipantSlot),
      localAgentRef,
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
  input: GroupSourceParticipantInput,
) {
  try {
    const result = await callApi(
      (realm) => addNimiRealmGroupSourceParticipant(realm, chatId, input),
      '添加群组 Source 失败',
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('add-group-source', error, {
      chatId,
      sourceRef: normalizeText(input.sourceRef?.sourceContentHash),
      sourceId: normalizeText(input.sourceRef?.sourceId),
    });
    throw error;
  }
}

export async function removeGroupChatSource(
  callApi: RealmGroupChatApiCaller,
  emitRealmGroupChatError: RealmGroupChatErrorEmitter,
  chatId: string,
  runtimeParticipantSlot: string,
) {
  try {
    await callApi(
      (realm) => removeNimiRealmGroupSourceParticipant(realm, chatId, runtimeParticipantSlot),
      '移除群组 Source 失败',
    );
  } catch (error) {
    emitRealmGroupChatError('remove-group-source', error, { chatId, runtimeParticipantSlot });
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
  commitRealmGroupSourceMessageCandidate: (
    chatId: string,
    participant: GroupParticipantDto,
    triggerMessage: GroupMessageViewDto,
  ) =>
    commitRealmGroupSourceMessageCandidateHandoff(
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
  addGroupSource: (chatId: string, input: GroupSourceParticipantInput) =>
    addGroupChatSource(callRealmApi, emitRealmDataError, chatId, input),
  removeGroupSource: (chatId: string, runtimeParticipantSlot: string) =>
    removeGroupChatSource(callRealmApi, emitRealmDataError, chatId, runtimeParticipantSlot),
};
