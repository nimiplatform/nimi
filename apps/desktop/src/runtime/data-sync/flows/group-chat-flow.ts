import { getPlatformClient } from '@nimiplatform/sdk';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { createRuntimeProtectedScopeHelper } from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@runtime/net/json';

type GroupChatViewDto = RealmModel<'GroupChatViewDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
type ListGroupChatsResultDto = RealmModel<'ListGroupChatsResultDto'>;
type ListGroupMessagesResultDto = RealmModel<'ListGroupMessagesResultDto'>;
type RealmGroupMessageCandidateCommitResultDto = RealmModel<'RealmGroupMessageCandidateCommitResultDto'>;
type MessageType = RealmModel<'MessageType'>;

export type { GroupChatViewDto, GroupMessageViewDto };

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;
type CurrentUserReader = () => Record<string, unknown> | null;

let runtimeProtectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createStableClientId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random.replaceAll('-', '')}`;
}

function requireCurrentUserId(getCurrentUser: CurrentUserReader): string {
  const id = normalizeText(getCurrentUser()?.id);
  if (!id) {
    throw new Error('group agent candidate handoff requires authenticated current user id');
  }
  return id;
}

function getRuntimeProtectedAccess(getCurrentUser: CurrentUserReader) {
  if (runtimeProtectedAccess) {
    return runtimeProtectedAccess;
  }
  const runtime = getPlatformClient().runtime;
  runtimeProtectedAccess = createRuntimeProtectedScopeHelper({
    runtime,
    getSubjectUserId: async () => requireCurrentUserId(getCurrentUser),
  });
  return runtimeProtectedAccess;
}

function requireOwnedAgentSlot(input: {
  participant: GroupParticipantDto;
  currentUserId: string;
}): {
  realmGroupAgentSlotId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
} {
  const ownerUserId = normalizeText(input.participant.agentOwnerId);
  const realmAgentId = normalizeText(input.participant.realmAgentId);
  const realmGroupAgentSlotId = normalizeText(input.participant.realmGroupAgentSlotId);
  const localAgentRef = normalizeText(input.participant.localAgentRef);
  if (
    input.participant.type !== 'agent'
    || !realmGroupAgentSlotId
    || !ownerUserId
    || !realmAgentId
    || !localAgentRef
  ) {
    throw new Error('group agent candidate handoff requires Realm projected agent slot identity');
  }
  if (ownerUserId !== input.currentUserId) {
    throw new Error('group agent candidate handoff requires the current user to own the local agent slot');
  }
  const expectedLocalAgentRef = `local-agent:${ownerUserId}:${realmAgentId}`;
  if (localAgentRef !== expectedLocalAgentRef) {
    throw new Error('group agent candidate handoff local agent ref does not match Realm slot identity');
  }
  return {
    realmGroupAgentSlotId,
    ownerUserId,
    realmAgentId,
    localAgentRef,
  };
}

function requireCandidateHandle(
  response: Awaited<ReturnType<ReturnType<typeof getPlatformClient>['runtime']['agent']['createRealmGroupMessageCandidate']>>,
) {
  const candidate = response.candidate;
  if (!candidate) {
    throw new Error('Runtime did not return a Realm group message candidate handle');
  }
  if (candidate.candidateKind !== 'REALM_GROUP_MESSAGE_CANDIDATE') {
    throw new Error('Runtime returned an unexpected Realm group message candidate kind');
  }
  return candidate;
}

function assertCandidateHandleMatchesExpectedSlot(input: {
  candidate: ReturnType<typeof requireCandidateHandle>;
  slot: ReturnType<typeof requireOwnedAgentSlot>;
  triggerRef: string;
}): void {
  if (
    input.candidate.realmGroupAgentSlotId !== input.slot.realmGroupAgentSlotId
    || input.candidate.localAgentRef !== input.slot.localAgentRef
    || input.candidate.triggerRef !== input.triggerRef
  ) {
    throw new Error('Runtime Realm group message candidate handle does not match expected Realm slot handoff');
  }
}

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
    emitDataSyncError('send-group-message', error, { chatId });
    throw error;
  }
}

export async function commitRealmGroupMessageCandidateHandoff(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  getCurrentUser: CurrentUserReader,
  chatId: string,
  participant: GroupParticipantDto,
  triggerMessage: GroupMessageViewDto,
): Promise<RealmGroupMessageCandidateCommitResultDto> {
  const currentUserId = requireCurrentUserId(getCurrentUser);
  const slot = requireOwnedAgentSlot({ participant, currentUserId });
  const runtime = getPlatformClient().runtime;
  const protectedAccess = getRuntimeProtectedAccess(getCurrentUser);
  const triggerMessageId = normalizeText(triggerMessage.id);
  if (!triggerMessageId) {
    throw new Error('group agent candidate handoff requires a committed Realm trigger message');
  }

  const triggerRef = `realm://group-chats/${chatId}/messages/${triggerMessageId}`;
  const idempotencyKey = createStableClientId('rgmc');

  try {
    const response = await protectedAccess.withScopes(
      ['runtime.agent.create_realm_group_message_candidate'],
      (options) => runtime.agent.createRealmGroupMessageCandidate({
        context: {
          appId: runtime.appId,
          subjectUserId: slot.ownerUserId,
        },
        realmGroupThreadId: chatId,
        realmGroupAgentSlotId: slot.realmGroupAgentSlotId,
        ownerUserId: slot.ownerUserId,
        realmAgentId: slot.realmAgentId,
        localAgentRef: slot.localAgentRef,
        triggerRef,
        membershipSnapshotRef: `realm://group-chats/${chatId}/membership/current`,
        readCursorRef: `realm://group-chats/${chatId}/read-cursors/${slot.ownerUserId}`,
        replyTargetRef: '',
        roomOrchestrationRef: `realm://group-chats/${chatId}/orchestration/current`,
        idempotencyKey,
        contextRefs: {
          'realm.group.thread.snapshot': `realm-context://group-chats/${chatId}/thread/current`,
          'realm.group.agent_slot.snapshot': `realm-context://group-agent-slots/${slot.realmGroupAgentSlotId}/current`,
          'realm.group.recent_messages.snapshot': `realm-context://group-chats/${chatId}/recent-messages/current`,
          'realm.group.policy.snapshot': `realm-context://group-chats/${chatId}/policy/current`,
        },
      }, options),
    );
    const candidate = requireCandidateHandle(response);
    assertCandidateHandleMatchesExpectedSlot({ candidate, slot, triggerRef });
    const result = await callApi(
      (realm) => realm.services.GroupChatsService.commitRealmGroupMessageCandidate(chatId, {
        candidateId: candidate.candidateId,
        candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
        candidateEvidenceRef: candidate.candidateEvidenceRef,
        evidenceHash: candidate.evidenceHash,
        runtimeTraceRef: candidate.runtimeTraceRef,
        expectedRealmGroupAgentSlotId: slot.realmGroupAgentSlotId,
        expectedLocalAgentRef: slot.localAgentRef,
        triggerRef,
        idempotencyKey,
        clientCorrelationId: idempotencyKey,
      }),
      '提交群组 Agent 候选消息失败',
    );
    return result;
  } catch (error) {
    emitDataSyncError('commit-realm-group-message-candidate', error, {
      chatId,
      realmGroupAgentSlotId: slot.realmGroupAgentSlotId,
      localAgentRef: slot.localAgentRef,
    });
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
