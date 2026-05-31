import { getPlatformClient } from '@nimiplatform/sdk';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  RealmGroupMessageCandidateCommitDisposition,
  buildRuntimeLocalAgentRef,
  createNimiClientId,
  createRuntimeProtectedScopeHelper,
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

let runtimeProtectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

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
  const expectedLocalAgentRef = buildRuntimeLocalAgentRef({ ownerUserId, realmAgentId });
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

function timestampToIso(value: { seconds?: string | number | bigint; nanos?: number } | undefined, fieldName: string): string {
  if (!value) {
    throw new Error(`Runtime Realm group message candidate evidence missing ${fieldName}`);
  }
  const seconds = Number(value.seconds ?? 0);
  const nanos = Number(value.nanos ?? 0);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
    throw new Error(`Runtime Realm group message candidate evidence has invalid ${fieldName}`);
  }
  return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
}

function mapRuntimeCommitDisposition(
  value: RealmGroupMessageCandidateCommitDisposition,
): 'MESSAGE_CANDIDATE' | 'REFUSAL_CANDIDATE' {
  if (value === RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE) {
    return 'MESSAGE_CANDIDATE';
  }
  if (value === RealmGroupMessageCandidateCommitDisposition.REFUSAL_CANDIDATE) {
    return 'REFUSAL_CANDIDATE';
  }
  throw new Error('Runtime Realm group message candidate evidence has unsupported commit disposition');
}

function requireCandidateEvidence(
  response: Awaited<ReturnType<ReturnType<typeof getPlatformClient>['runtime']['agent']['getRealmGroupMessageCandidateEvidence']>>,
) {
  const evidence = response.evidence;
  if (!evidence) {
    throw new Error('Runtime did not return Realm group message candidate evidence');
  }
  if (evidence.candidateKind !== 'REALM_GROUP_MESSAGE_CANDIDATE') {
    throw new Error('Runtime returned an unexpected Realm group message candidate evidence kind');
  }
  return evidence;
}

function assertCandidateEvidenceMatchesHandle(input: {
  candidate: ReturnType<typeof requireCandidateHandle>;
  evidence: ReturnType<typeof requireCandidateEvidence>;
  slot: ReturnType<typeof requireOwnedAgentSlot>;
  triggerRef: string;
  chatId: string;
}): void {
  if (
    input.evidence.candidateId !== input.candidate.candidateId
    || input.evidence.evidenceHash !== input.candidate.evidenceHash
    || input.evidence.runtimeTraceRef !== input.candidate.runtimeTraceRef
    || input.evidence.realmGroupThreadId !== input.chatId
    || input.evidence.realmGroupAgentSlotId !== input.slot.realmGroupAgentSlotId
    || input.evidence.localAgentRef !== input.slot.localAgentRef
    || input.evidence.triggerRef !== input.triggerRef
  ) {
    throw new Error('Runtime Realm group message candidate evidence does not match the candidate handle');
  }
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
          ownerUserId: slot.ownerUserId,
          realmAgentId: slot.realmAgentId,
          localAgentRef: slot.localAgentRef,
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
    const evidenceResponse = await protectedAccess.withScopes(
      ['runtime.agent.get_realm_group_message_candidate_evidence'],
      (options) => runtime.agent.getRealmGroupMessageCandidateEvidence({
        context: {
          appId: runtime.appId,
          subjectUserId: slot.ownerUserId,
          ownerUserId: slot.ownerUserId,
          realmAgentId: slot.realmAgentId,
          localAgentRef: slot.localAgentRef,
        },
        candidateId: candidate.candidateId,
        candidateKind: candidate.candidateKind,
        candidateEvidenceRef: candidate.candidateEvidenceRef,
        evidenceHash: candidate.evidenceHash,
        runtimeTraceRef: candidate.runtimeTraceRef,
        expectedRealmGroupAgentSlotId: slot.realmGroupAgentSlotId,
        expectedLocalAgentRef: slot.localAgentRef,
        triggerRef,
        targetRealmGroupThreadId: chatId,
      }, options),
    );
    const evidence = requireCandidateEvidence(evidenceResponse);
    assertCandidateEvidenceMatchesHandle({ candidate, evidence, slot, triggerRef, chatId });
    const commitDisposition = mapRuntimeCommitDisposition(evidence.commitDisposition);
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
        outputCandidateRef: evidence.outputCandidateRef,
        auditLineageRef: evidence.auditLineageRef,
        policyVerdictRef: evidence.policyVerdictRef,
        createdAt: timestampToIso(evidence.createdAt, 'createdAt'),
        expiresAt: timestampToIso(evidence.expiresAt, 'expiresAt'),
        commitDisposition,
        messageType: evidence.messageType === 'TEXT' ? 'TEXT' : undefined,
        body: evidence.body || undefined,
        bodyHash: evidence.bodyHash || undefined,
        refusalCode: evidence.refusalCode || undefined,
        refusalReason: evidence.refusalReason || undefined,
        refusalHash: evidence.refusalHash || undefined,
        idempotencyKey,
        clientCorrelationId: idempotencyKey,
      }),
      '提交群组 Agent 候选消息失败',
    );
    return result;
  } catch (error) {
    emitRealmGroupChatError('commit-realm-group-message-candidate', error, {
      chatId,
      realmGroupAgentSlotId: slot.realmGroupAgentSlotId,
      localAgentRef: slot.localAgentRef,
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
